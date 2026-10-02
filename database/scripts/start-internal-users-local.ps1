[CmdletBinding()]
param(
    [SecureString]$OwnerPassword,
    [SecureString]$RuntimePassword,
    [SecureString]$AdministratorPassword,
    [string]$AdministratorLogin,
    [string]$AdministratorName
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repo
Write-Host 'TallerTrack: migrar entorno local (V022), completar grants runtime, preparar primer Administrador si falta y ejecutar API por USB.'
Write-Host 'Las contraseñas se piden sin eco; no se guardan en archivos ni se cambian cuentas Oracle existentes.'
$ownerSecret = $OwnerPassword
$runtimeSecret = $RuntimePassword
if ($null -eq $ownerSecret) { $ownerSecret = Read-Host 'Contrasena actual de TT_OWNER' -AsSecureString }
if ($null -eq $runtimeSecret) { $runtimeSecret = Read-Host 'Contrasena actual de TT_APP' -AsSecureString }
$saved = @{}
$names = @('TT_DB_URL','TT_DB_USER','TT_DB_PASSWORD','TT_ORACLE_USER','TT_ORACLE_PASSWORD','TT_ORACLE_CONNECT_STRING',
    'TT_ORACLE_SCHEMA','TT_ORACLE_EXPECTED_DATABASE','TT_ORACLE_EXPECTED_SERVICE','TT_API_BIND_HOST','TT_PRIVATE_STORAGE_ROOT',
    'TT_AUTH_SIGNING_KEY_BASE64','TT_UPLOAD_RECEIPT_HMAC_KEY_BASE64')
$operatingProfile = @{}
foreach ($line in Get-Content -LiteralPath (Join-Path $repo 'apps\api\.env.example')) {
    if ($line -match '^(TT_[A-Z0-9_]+)=([^<].*)$') { $operatingProfile[$matches[1]] = $matches[2]; $names += $matches[1] }
}
foreach ($name in ($names | Select-Object -Unique)) { $saved[$name] = [Environment]::GetEnvironmentVariable($name,'Process') }
try {
    $env:TT_DB_URL = 'jdbc:oracle:thin:@//127.0.0.1:1521/XEPDB1'
    $env:TT_DB_USER = 'TT_OWNER'
    $env:TT_DB_PASSWORD = ([PSCredential]::new('TT_OWNER',$ownerSecret)).GetNetworkCredential().Password
    & (Join-Path $PSScriptRoot 'invoke-flyway.ps1') migrate
    & (Join-Path $PSScriptRoot 'invoke-flyway.ps1') validate
    $prepared = & node apps/api/scripts/prepare-internal-users-environment.js
    if ($LASTEXITCODE -ne 0) { throw 'Preparación del entorno fallida.' }
    if ($prepared -contains 'ADMIN_REQUIRED=1') {
        Write-Host 'No existe Administrador activo. Este es el único bootstrap; los empleados se crearán desde el teléfono.'
        $adminLogin = $AdministratorLogin
        $adminName = $AdministratorName
        $adminPassword = $AdministratorPassword
        if ([string]::IsNullOrWhiteSpace($adminLogin)) { $adminLogin = Read-Host 'Usuario del primer Administrador' }
        if ([string]::IsNullOrWhiteSpace($adminName)) { $adminName = Read-Host 'Nombre mostrado del Administrador' }
        if ($null -eq $adminPassword) { $adminPassword = Read-Host 'Contrasena del Administrador (12 a 128 caracteres)' -AsSecureString }
        & (Join-Path $PSScriptRoot 'bootstrap-internal-user.ps1') -Login $adminLogin -Name $adminName -Roles ADMINISTRADOR -Password $adminPassword -OwnerPassword $ownerSecret
        $adminPassword = $null
    }
    # The HTTP process must never inherit owner credentials.
    Remove-Item Env:TT_DB_PASSWORD
    $ownerSecret = $null
    $OwnerPassword = $null; $AdministratorPassword = $null
    foreach ($name in $operatingProfile.Keys) { [Environment]::SetEnvironmentVariable($name,$operatingProfile[$name],'Process') }
    $env:TT_ORACLE_USER = 'TT_APP'
    $env:TT_ORACLE_PASSWORD = ([PSCredential]::new('TT_APP',$runtimeSecret)).GetNetworkCredential().Password
    $runtimeSecret = $null
    $RuntimePassword = $null
    $env:TT_ORACLE_CONNECT_STRING = '127.0.0.1:1521/XEPDB1'
    $env:TT_ORACLE_SCHEMA = 'TT_OWNER'
    $env:TT_ORACLE_EXPECTED_DATABASE = 'XE'
    $env:TT_ORACLE_EXPECTED_SERVICE = 'XEPDB1'
    $env:TT_API_BIND_HOST = '127.0.0.1'
    $env:TT_PRIVATE_STORAGE_ROOT = Join-Path $repo '.data\private-files'
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        foreach ($name in 'TT_AUTH_SIGNING_KEY_BASE64','TT_UPLOAD_RECEIPT_HMAC_KEY_BASE64') {
            $bytes = New-Object byte[] 32; $rng.GetBytes($bytes)
            [Environment]::SetEnvironmentVariable($name,[Convert]::ToBase64String($bytes),'Process')
            [Array]::Clear($bytes,0,$bytes.Length)
        }
    } finally { $rng.Dispose() }
    Write-Host 'Claves de desarrollo efímeras: al reiniciar este proceso debes iniciar sesión otra vez.'
    Write-Host 'API en 127.0.0.1:3000. Mantén esta ventana abierta. El teléfono usa adb reverse por USB.'
    & node apps/api/src/server.js
    if ($LASTEXITCODE -ne 0) { throw 'La API no pudo iniciarse; comprueba las credenciales runtime.' }
} finally {
    $ownerSecret = $null; $runtimeSecret = $null; $adminPassword = $null
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name,$saved[$name],'Process') }
}
