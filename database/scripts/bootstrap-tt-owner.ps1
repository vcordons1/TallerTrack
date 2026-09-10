[CmdletBinding()]
param(
    [SecureString]$OwnerPassword,

    [ValidatePattern('^(TT_OWNER|TT_TEST_[A-F0-9]{12})$')]
    [string]$SchemaName = 'TT_OWNER'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$sqlPlusCommand = Get-Command 'sqlplus' -ErrorAction SilentlyContinue
if ($null -eq $sqlPlusCommand) {
    throw 'sqlplus is required to bootstrap TT_OWNER.'
}

if ($SchemaName -ne 'TT_OWNER' -and -not $PSBoundParameters.ContainsKey('OwnerPassword')) {
    throw 'A temporary test schema requires an explicit SecureString password.'
}

if ($null -eq $OwnerPassword) {
    $OwnerPassword = Read-Host 'New TT_OWNER password' -AsSecureString
}

$credential = [System.Management.Automation.PSCredential]::new($SchemaName, $OwnerPassword)
$plainPassword = $credential.GetNetworkCredential().Password

try {
    if ($plainPassword.Length -lt 12 -or $plainPassword.Length -gt 128) {
        throw 'The owner password must contain between 12 and 128 characters.'
    }
    if ($plainPassword -notmatch '^[A-Za-z0-9#_$!?%+=.,:@-]+$') {
        throw 'The owner password contains unsupported characters for this bootstrap path.'
    }

    $sql = @"
whenever sqlerror exit sql.sqlcode
set echo off verify off feedback off heading off pagesize 0
alter session set container = XEPDB1;
create user $SchemaName identified by "$plainPassword"
  default tablespace USERS
  temporary tablespace TEMP
  quota 20M on USERS;
grant create session, create table, create sequence, create procedure, create view to $SchemaName;
exit
"@

    $output = $sql | & $sqlPlusCommand.Source -s / as sysdba 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        if ($output.Contains($plainPassword)) {
            throw 'Oracle bootstrap failed and its output contained sensitive material; output suppressed.'
        }
        throw "Oracle bootstrap failed: $($output.Trim())"
    }
    if ($output.Contains($plainPassword)) {
        throw 'Oracle bootstrap output contained sensitive material; output suppressed.'
    }

    Write-Output "Schema $SchemaName created with CREATE PROCEDURE, CREATE SEQUENCE, CREATE SESSION, CREATE TABLE, CREATE VIEW, and a 20 MiB USERS quota."
}
finally {
    $plainPassword = $null
    $credential = $null
}
