[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..')).Path
$ownerBootstrap = Join-Path $repo 'database\scripts\bootstrap-tt-owner.ps1'
$appBootstrap = Join-Path $repo 'database\scripts\bootstrap-tt-app.ps1'
$flyway = Join-Path $repo 'database\scripts\invoke-flyway.ps1'
$sqlplus = (Get-Command sqlplus -ErrorAction Stop).Source
$suffix = ([guid]::NewGuid().ToString('N').Substring(0,12)).ToUpperInvariant()
$owner = "TT_TEST_$suffix"
$runtimeUser = 'TT_APP'
$ownerPassword = "Ow1!$suffix"
$runtimePassword = "Ap1!$suffix"
$saved = @{}
$environmentNames = @(
    'TT_DB_URL','TT_DB_USER','TT_DB_PASSWORD','TT_RUN_ORACLE_INTEGRATION',
    'TT_ORACLE_USER','TT_ORACLE_PASSWORD','TT_ORACLE_CONNECT_STRING','TT_ORACLE_SCHEMA',
    'TT_ORACLE_EXPECTED_DATABASE','TT_ORACLE_EXPECTED_SERVICE','TT_ORACLE_POOL_MIN','TT_ORACLE_POOL_MAX','TT_ORACLE_POOL_INCREMENT'
)
foreach ($name in $environmentNames) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }

function ConvertTo-TestSecureString([string]$Value) {
    $secure = [Security.SecureString]::new()
    foreach ($character in $Value.ToCharArray()) { $secure.AppendChar($character) }
    $secure.MakeReadOnly()
    return $secure
}

function Invoke-SysSql([string]$Sql) {
    $script = @"
whenever sqlerror exit sql.sqlcode
set echo off verify off feedback off heading off pagesize 0 linesize 500 trimspool on
alter session set container = XEPDB1;
$Sql
exit
"@
    $output = $script | & $sqlplus -s / as sysdba 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "Oracle SYS operation failed: $output" }
    return $output.Trim()
}

function Invoke-RuntimeSql([string]$Sql, [bool]$ShouldSucceed = $true) {
    $script = @"
set echo off verify off feedback off heading off pagesize 0 linesize 500 trimspool on
whenever sqlerror exit sql.sqlcode
connect $runtimeUser/"$runtimePassword"@//127.0.0.1:1521/XEPDB1
$Sql
exit
"@
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = $script | & $sqlplus -s /nolog 2>&1 | Out-String
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $oldPreference }
    if ($output.Contains($runtimePassword)) { throw 'Runtime SQL output exposed the generated password.' }
    if ($ShouldSucceed -and $code -ne 0) { throw "Runtime SQL failed: $output" }
    if (-not $ShouldSucceed -and $code -eq 0) { throw "Runtime SQL unexpectedly succeeded: $Sql" }
    return $output.Trim()
}

$ownerCreated = $false
$runtimeCreated = $false
$failure = $null
try {
    & $ownerBootstrap -SchemaName $owner -OwnerPassword (ConvertTo-TestSecureString $ownerPassword) | Out-Null
    $ownerCreated = $true
    $env:TT_DB_URL = 'jdbc:oracle:thin:@//127.0.0.1:1521/XEPDB1'
    $env:TT_DB_USER = $owner
    $env:TT_DB_PASSWORD = $ownerPassword
    & $flyway migrate | Out-Null

    & $appBootstrap -OwnerSchema $owner -RuntimeUser $runtimeUser -RuntimePassword (ConvertTo-TestSecureString $runtimePassword) | Out-Null
    $runtimeCreated = $true

    $privileges = Invoke-SysSql @"
select 'SYS=' || listagg(privilege, ',') within group (order by privilege) from dba_sys_privs where grantee='$runtimeUser';
select 'OBJECTS=' || count(*) from dba_tab_privs where grantee='$runtimeUser' and privilege='SELECT' and owner='$owner';
select 'EXECUTE=' || count(*) from dba_tab_privs where grantee='$runtimeUser' and privilege='EXECUTE' and owner='$owner' and table_name in ('PKG_VEHICULOS','PKG_AGENDA','PKG_ORDENES');
select 'QUOTAS=' || count(*) from dba_ts_quotas where username='$runtimeUser' and max_bytes <> 0;
"@
    if ($privileges -notmatch 'SYS=CREATE SESSION' -or $privileges -notmatch 'OBJECTS=3' -or $privileges -notmatch 'EXECUTE=3' -or $privileges -notmatch 'QUOTAS=0') {
        throw "Unexpected TT_APP privilege evidence: $privileges"
    }

    $readEvidence = Invoke-RuntimeSql @"
select 'IDENTITY=' || sys_context('USERENV','CURRENT_USER') || '@' || sys_context('USERENV','SERVICE_NAME') from dual;
select 'MIGRATIONS=' || count(distinct lpad("version",3,'0')) from $owner."flyway_schema_history" where "success"=1 and lpad("version",3,'0') in ('001','002','003','004');
select 'I01=' || (select count(*) from $owner.CONFIG_TALLER) || ':' || (select count(*) from $owner.ROL) from dual;
"@
    if ($readEvidence -notmatch "IDENTITY=$runtimeUser@XEPDB1" -or $readEvidence -notmatch 'MIGRATIONS=4' -or $readEvidence -notmatch 'I01=1:5') {
        throw "Unexpected runtime evidence: $readEvidence"
    }
    $ddlFailure = Invoke-RuntimeSql 'create table forbidden_table (id number);' $false
    if ($ddlFailure -notmatch 'ORA-01031') { throw "DDL was denied with an unexpected result: $ddlFailure" }
    $dmlFailure = Invoke-RuntimeSql "delete from $owner.ROL where codigo_rol='CLIENTE';" $false
    if ($dmlFailure -notmatch 'ORA-01031') { throw "DML was denied with an unexpected result: $dmlFailure" }

    $env:TT_RUN_ORACLE_INTEGRATION = '1'
    $env:TT_ORACLE_USER = $runtimeUser
    $env:TT_ORACLE_PASSWORD = $runtimePassword
    $env:TT_ORACLE_CONNECT_STRING = '127.0.0.1:1521/XEPDB1'
    $env:TT_ORACLE_SCHEMA = $owner
    $env:TT_ORACLE_EXPECTED_DATABASE = 'XE'
    $env:TT_ORACLE_EXPECTED_SERVICE = 'XEPDB1'
    $env:TT_ORACLE_POOL_MIN = '0'
    $env:TT_ORACLE_POOL_MAX = '2'
    $env:TT_ORACLE_POOL_INCREMENT = '1'

    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $testOutput = & npm.cmd test --workspace apps/api 2>&1 | Out-String
        $testExitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $oldPreference }
    if ($testExitCode -ne 0) { throw "API Oracle integration tests failed: $testOutput" }
    foreach ($password in $ownerPassword,$runtimePassword) {
        if ($testOutput.Contains($password)) { throw 'API test output exposed a generated password.' }
    }

    Write-Output 'PASS Oracle runtime: Thin-mode Express readiness reached XEPDB1 through one reused pool.'
    Write-Output 'PASS readiness: exact HTTP 200 body; real bad credential stayed live and returned safe HTTP 503.'
    Write-Output 'PASS least privilege: CREATE SESSION, exactly three SELECT grants, three package executes, zero quota; DDL and direct DML denied.'
    Write-Output "ORACLE_EVIDENCE $($readEvidence -replace '\s+',' ')"
}
catch {
    $failure = $_
}
finally {
    if ($runtimeCreated -and $runtimeUser -eq 'TT_APP') {
        Invoke-SysSql "drop user $runtimeUser;" | Out-Null
    }
    if ($ownerCreated -and $owner -match '^TT_TEST_[A-F0-9]{12}$') {
        Invoke-SysSql "drop user $owner cascade;" | Out-Null
    }
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
}

if ($null -ne $failure) {
    throw $failure.Exception.Message
}
