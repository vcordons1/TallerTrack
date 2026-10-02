[CmdletBinding()]
param(
    [SecureString]$RuntimePassword,

    [ValidatePattern('^(TT_APP|TT_TEST_APP_[A-F0-9]{12})$')]
    [string]$RuntimeUser = 'TT_APP',

    [ValidatePattern('^(TT_OWNER|TT_TEST_[A-F0-9]{12})$')]
    [string]$OwnerSchema = 'TT_OWNER'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$sqlPlusCommand = Get-Command 'sqlplus' -ErrorAction SilentlyContinue
if ($null -eq $sqlPlusCommand) { throw 'sqlplus is required to bootstrap TT_APP.' }
if ($RuntimeUser -ne 'TT_APP' -and -not $PSBoundParameters.ContainsKey('RuntimePassword')) {
    throw 'A temporary runtime user requires an explicit SecureString password.'
}
if ($null -eq $RuntimePassword) { $RuntimePassword = Read-Host 'New TT_APP password' -AsSecureString }

$credential = [System.Management.Automation.PSCredential]::new($RuntimeUser, $RuntimePassword)
$plainPassword = $credential.GetNetworkCredential().Password
$created = $false

function Invoke-SysSql([string]$Sql) {
    $script = @"
whenever sqlerror exit sql.sqlcode
set echo off verify off feedback off heading off pagesize 0
alter session set container = XEPDB1;
$Sql
exit
"@
    $output = $script | & $sqlPlusCommand.Source -s / as sysdba 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        if ($output.Contains($plainPassword)) { throw 'Oracle runtime bootstrap failed; sensitive output suppressed.' }
        throw "Oracle runtime bootstrap failed: $($output.Trim())"
    }
    if ($output.Contains($plainPassword)) { throw 'Oracle runtime bootstrap output contained sensitive material; output suppressed.' }
    return $output.Trim()
}

try {
    if ($plainPassword.Length -lt 12 -or $plainPassword.Length -gt 128) {
        throw 'The runtime password must contain between 12 and 128 characters.'
    }
    if ($plainPassword -notmatch '^[A-Za-z0-9#_$!?%+=.,:@-]+$') {
        throw 'The runtime password contains unsupported characters for this bootstrap path.'
    }

    $preflight = Invoke-SysSql @"
select 'RUNTIME=' || count(*) from dba_users where username='$RuntimeUser';
select 'OBJECTS=' || count(*) from dba_objects
where owner='$OwnerSchema'
  and ((object_name in ('CONFIG_TALLER','ROL') and object_type='TABLE')
    or (object_name='flyway_schema_history' and object_type='TABLE')
    or (object_name in ('PKG_VEHICULOS','PKG_AGENDA','PKG_ORDENES','PKG_IDENTIDAD','PKG_RECEPCION_HTTP','PKG_CONSULTAS_CLIENTES_VEHICULOS','PKG_CONSULTAS_ORDENES','PKG_DIAGNOSTICO_GRATUITO','PKG_USUARIOS_INTERNOS','PKG_CLIENTES_VEHICULOS_HTTP') and object_type='PACKAGE'));
"@
    if ($preflight -notmatch 'RUNTIME=0') { throw "Oracle user $RuntimeUser already exists; refusing to replace or alter it." }
    if ($preflight -notmatch 'OBJECTS=13') { throw "Schema $OwnerSchema is not migrated through the objects required by TT_APP." }

    Invoke-SysSql @"
create user $RuntimeUser identified by "$plainPassword"
  default tablespace USERS
  temporary tablespace TEMP
  quota 0 on USERS;
"@ | Out-Null
    $created = $true

    Invoke-SysSql @"
grant create session to $RuntimeUser;
grant select on $OwnerSchema."flyway_schema_history" to $RuntimeUser;
grant select on $OwnerSchema.CONFIG_TALLER to $RuntimeUser;
grant select on $OwnerSchema.ROL to $RuntimeUser;
grant execute on $OwnerSchema.PKG_VEHICULOS to $RuntimeUser;
grant execute on $OwnerSchema.PKG_AGENDA to $RuntimeUser;
grant execute on $OwnerSchema.PKG_ORDENES to $RuntimeUser;
grant execute on $OwnerSchema.PKG_IDENTIDAD to $RuntimeUser;
grant execute on $OwnerSchema.PKG_RECEPCION_HTTP to $RuntimeUser;
grant execute on $OwnerSchema.PKG_CONSULTAS_CLIENTES_VEHICULOS to $RuntimeUser;
grant execute on $OwnerSchema.PKG_CONSULTAS_ORDENES to $RuntimeUser;
grant execute on $OwnerSchema.PKG_DIAGNOSTICO_GRATUITO to $RuntimeUser;
grant execute on $OwnerSchema.PKG_USUARIOS_INTERNOS to $RuntimeUser;
grant execute on $OwnerSchema.PKG_CLIENTES_VEHICULOS_HTTP to $RuntimeUser;
"@ | Out-Null

    $evidence = Invoke-SysSql @"
select 'SYS=' || listagg(privilege, ',') within group (order by privilege)
from dba_sys_privs where grantee='$RuntimeUser';
select 'OBJECT=' || listagg(owner || '.' || table_name || ':' || privilege, ',') within group (order by owner, table_name, privilege)
from dba_tab_privs where grantee='$RuntimeUser';
select 'QUOTA=' || count(*) from dba_ts_quotas where username='$RuntimeUser' and max_bytes <> 0;
"@
    $normalizedEvidence = $evidence -replace '\s+', ''
    if ($normalizedEvidence -notmatch 'SYS=CREATESESSION' -or
        $normalizedEvidence -notmatch "OBJECT=$OwnerSchema\.CONFIG_TALLER:SELECT,$OwnerSchema\.PKG_AGENDA:EXECUTE,$OwnerSchema\.PKG_CLIENTES_VEHICULOS_HTTP:EXECUTE,$OwnerSchema\.PKG_CONSULTAS_CLIENTES_VEHICULOS:EXECUTE,$OwnerSchema\.PKG_CONSULTAS_ORDENES:EXECUTE,$OwnerSchema\.PKG_DIAGNOSTICO_GRATUITO:EXECUTE,$OwnerSchema\.PKG_IDENTIDAD:EXECUTE,$OwnerSchema\.PKG_ORDENES:EXECUTE,$OwnerSchema\.PKG_RECEPCION_HTTP:EXECUTE,$OwnerSchema\.PKG_USUARIOS_INTERNOS:EXECUTE,$OwnerSchema\.PKG_VEHICULOS:EXECUTE,$OwnerSchema\.ROL:SELECT,$OwnerSchema\.flyway_schema_history:SELECT" -or
        $normalizedEvidence -notmatch 'QUOTA=0') {
        throw "TT_APP privilege verification did not match the required least-privilege contract: $evidence"
    }

    Write-Output "Oracle runtime user $RuntimeUser created with CREATE SESSION, three readiness-only SELECT grants, and EXECUTE on ten bounded runtime packages; no nonzero quota, DDL, or direct DML privilege."
}
catch {
    if ($created) {
        try { Invoke-SysSql "drop user $RuntimeUser;" | Out-Null } catch { }
    }
    throw
}
finally {
    $plainPassword = $null
    $credential = $null
}
