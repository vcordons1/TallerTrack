[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$suffix = [guid]::NewGuid().ToString('N').Substring(0,12).ToUpperInvariant()
$owner = "TT_TEST_$suffix"
$runtime = "TT_TEST_APP_$suffix"
$ownerPassword = "Ow1!$suffix"
$runtimePassword = "Ap1!$suffix"
$sqlplus = (Get-Command sqlplus -ErrorAction Stop).Source
$flyway = Join-Path $repo 'database\scripts\invoke-flyway.ps1'
$ownerBootstrap = Join-Path $repo 'database\scripts\bootstrap-tt-owner.ps1'
$appBootstrap = Join-Path $repo 'database\scripts\bootstrap-tt-app.ps1'
$ownerCreated = $false
$runtimeCreated = $false
$saved = @{}
foreach ($name in 'TT_DB_URL','TT_DB_USER','TT_DB_PASSWORD','TT_ORACLE_USER','TT_ORACLE_PASSWORD',
    'TT_ORACLE_CONNECT_STRING','TT_ORACLE_SCHEMA','TT_RUN_CUSTOMER_VEHICLE_ORACLE_INTEGRATION') {
    $saved[$name] = [Environment]::GetEnvironmentVariable($name,'Process')
}

function As-Secure([string]$value) {
    $secure = [Security.SecureString]::new()
    foreach ($character in $value.ToCharArray()) { $secure.AppendChar($character) }
    $secure.MakeReadOnly()
    return $secure
}

function Sys-Sql([string]$sql) {
    $script = @"
whenever sqlerror exit sql.sqlcode
set echo off verify off feedback off heading off pagesize 0 linesize 1000 trimspool on
alter session set container = XEPDB1;
$sql
exit
"@
    $output = $script | & $sqlplus -s / as sysdba 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "Temporary Oracle operation failed: $output" }
    return $output.Trim()
}

function Owner-Sql([string]$sql) {
    $script = @"
whenever sqlerror exit sql.sqlcode rollback
set echo off verify off feedback off heading off pagesize 0 linesize 1000 trimspool on
connect $owner/"$ownerPassword"@//127.0.0.1:1521/XEPDB1
$sql
exit
"@
    $output = $script | & $sqlplus -s /nolog 2>&1 | Out-String
    if ($output.Contains($ownerPassword)) { throw 'Sensitive test output suppressed.' }
    if ($LASTEXITCODE -ne 0) { throw "Temporary owner operation failed: $output" }
    return $output.Trim()
}

try {
    & $ownerBootstrap -SchemaName $owner -OwnerPassword (As-Secure $ownerPassword) | Out-Null
    $ownerCreated = $true
    Sys-Sql "grant create trigger to $owner;" | Out-Null
    $env:TT_DB_URL = 'jdbc:oracle:thin:@//127.0.0.1:1521/XEPDB1'
    $env:TT_DB_USER = $owner
    $env:TT_DB_PASSWORD = $ownerPassword
    $env:FLYWAY_TARGET = '020'
    try {
        $migration = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $flyway migrate 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) { throw "V020 migration failed: $migration" }
    } finally { Remove-Item Env:FLYWAY_TARGET }
    $migration = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $flyway migrate 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "V021 upgrade failed: $migration" }
    $valid = Owner-Sql "select 'VALID='||count(*) from user_objects where object_name in ('PKG_CLIENTES_VEHICULOS_HTTP','PKG_CONSULTAS_CLIENTES_VEHICULOS','PKG_VEHICULOS') and status='VALID';`nselect name||':'||line||':'||text from user_errors;"
    if ($valid -notmatch 'VALID=6') { throw "Customer/vehicle packages failed compilation: $valid" }
    & $appBootstrap -RuntimeUser $runtime -OwnerSchema $owner -RuntimePassword (As-Secure $runtimePassword) | Out-Null
    $runtimeCreated = $true
    $env:TT_RUN_CUSTOMER_VEHICLE_ORACLE_INTEGRATION = '1'
    $env:TT_ORACLE_USER = $runtime
    $env:TT_ORACLE_PASSWORD = $runtimePassword
    $env:TT_ORACLE_CONNECT_STRING = '127.0.0.1:1521/XEPDB1'
    $env:TT_ORACLE_SCHEMA = $owner
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $nodeOutput = & node --test apps/api/test/customers-vehicles.oracle.integration.test.js 2>&1 | Out-String; $code = $LASTEXITCODE }
    finally { $ErrorActionPreference = $oldPreference }
    if ($nodeOutput.Contains($ownerPassword) -or $nodeOutput.Contains($runtimePassword)) { throw 'Sensitive test output suppressed.' }
    Write-Output $nodeOutput.Trim()
    if ($code -ne 0) { throw 'Customer/vehicle Oracle integration failed.' }
    Write-Output 'PASS V020 to V021 upgrade, valid packages, real A/R customer and vehicle HTTP flow, isolated runtime privileges.'
}
finally {
    if ($runtimeCreated -and $runtime -match '^TT_TEST_APP_[A-F0-9]{12}$') { Sys-Sql "drop user $runtime;" | Out-Null }
    if ($ownerCreated -and $owner -match '^TT_TEST_[A-F0-9]{12}$') { Sys-Sql "drop user $owner cascade;" | Out-Null }
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name,$saved[$name],'Process') }
}
