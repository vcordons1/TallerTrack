[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateLength(1, 150)]
    [string]$Login,

    [Parameter(Mandatory)]
    [ValidateLength(1, 200)]
    [string]$Name,

    [Parameter(Mandatory)]
    [ValidateSet('ADMINISTRADOR','RECEPCIONISTA','MECANICO','INVENTARIO')]
    [string[]]$Roles,

    [SecureString]$Password,
    [SecureString]$OwnerPassword,
    [string]$OwnerUser = 'TT_OWNER',
    [string]$OwnerSchema = 'TT_OWNER',
    [string]$ConnectString = '127.0.0.1:1521/XEPDB1'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($OwnerUser -ne $OwnerSchema -or $OwnerUser -eq 'TT_APP' -or $OwnerUser -like 'TT_TEST_APP_*') {
    throw 'Bootstrap requires the migrated owner schema, never TT_APP.'
}
if ($null -eq $Password) { $Password = Read-Host 'New internal-user password' -AsSecureString }
if ($null -eq $OwnerPassword) { $OwnerPassword = Read-Host "$OwnerUser Oracle password" -AsSecureString }

$userCredential = [System.Management.Automation.PSCredential]::new('internal-user', $Password)
$ownerCredential = [System.Management.Automation.PSCredential]::new($OwnerUser, $OwnerPassword)
$plainUserPassword = $userCredential.GetNetworkCredential().Password
$previous = @{}
foreach ($environmentName in 'TT_BOOTSTRAP_ORACLE_USER','TT_BOOTSTRAP_ORACLE_SCHEMA','TT_BOOTSTRAP_ORACLE_PASSWORD','TT_BOOTSTRAP_ORACLE_CONNECT_STRING') {
    $previous[$environmentName] = [Environment]::GetEnvironmentVariable($environmentName, 'Process')
}

try {
    $env:TT_BOOTSTRAP_ORACLE_USER = $OwnerUser
    $env:TT_BOOTSTRAP_ORACLE_SCHEMA = $OwnerSchema
    $env:TT_BOOTSTRAP_ORACLE_PASSWORD = $ownerCredential.GetNetworkCredential().Password
    $env:TT_BOOTSTRAP_ORACLE_CONNECT_STRING = $ConnectString
    $script = Join-Path $PSScriptRoot '..\..\apps\api\scripts\bootstrap-internal-user.js'
    $plainUserPassword | & node $script --login $Login --name $Name --roles ($Roles -join ',')
    if ($LASTEXITCODE -ne 0) { throw 'Internal-user bootstrap failed.' }
}
finally {
    foreach ($environmentName in $previous.Keys) {
        [Environment]::SetEnvironmentVariable($environmentName, $previous[$environmentName], 'Process')
    }
    $plainUserPassword = $null
    $userCredential = $null
    $ownerCredential = $null
}
