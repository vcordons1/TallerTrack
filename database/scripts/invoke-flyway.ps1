[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('migrate', 'info', 'validate', 'testConnection')]
    [string]$Command
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-RequiredEnvironmentValue {
    param([Parameter(Mandatory = $true)][string]$Name)

    $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Required environment variable $Name is missing or empty."
    }

    return $value
}

$databaseUrl = Get-RequiredEnvironmentValue -Name 'TT_DB_URL'
$databaseUser = Get-RequiredEnvironmentValue -Name 'TT_DB_USER'
$databasePassword = Get-RequiredEnvironmentValue -Name 'TT_DB_PASSWORD'

if ($databaseUrl -notmatch '^jdbc:oracle:thin:@//[^/:\s]+:\d{1,5}/[^/\s]+$') {
    throw 'TT_DB_URL must use jdbc:oracle:thin:@//host:port/service and must not embed credentials.'
}

if ($databaseUser -notmatch '^[A-Za-z][A-Za-z0-9_$#]{0,29}$') {
    throw 'TT_DB_USER must be a simple Oracle username and cannot contain connection syntax.'
}

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$configPath = Join-Path $repositoryRoot 'database\flyway.conf'
$bundledFlyway = Join-Path $repositoryRoot '.tools\flyway-13.6.0\flyway.cmd'

if (-not (Test-Path -LiteralPath $bundledFlyway -PathType Leaf)) {
    throw 'Flyway 13.6.0 is not installed. Run npm run db:tool:setup first.'
}
$flywayExecutable = $bundledFlyway

$previousUrl = [Environment]::GetEnvironmentVariable('FLYWAY_URL', 'Process')
$previousUser = [Environment]::GetEnvironmentVariable('FLYWAY_USER', 'Process')
$previousPassword = [Environment]::GetEnvironmentVariable('FLYWAY_PASSWORD', 'Process')

try {
    $env:FLYWAY_URL = $databaseUrl
    $env:FLYWAY_USER = $databaseUser
    $env:FLYWAY_PASSWORD = $databasePassword

    Push-Location -LiteralPath $repositoryRoot
    try {
        $previousErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            & $flywayExecutable "-configFiles=$configPath" $Command
            $flywayExitCode = $LASTEXITCODE
        }
        finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }
        if ($flywayExitCode -ne 0) {
            throw "Flyway command '$Command' failed with exit code $flywayExitCode."
        }
    }
    finally {
        Pop-Location
    }
}
finally {
    [Environment]::SetEnvironmentVariable('FLYWAY_URL', $previousUrl, 'Process')
    [Environment]::SetEnvironmentVariable('FLYWAY_USER', $previousUser, 'Process')
    [Environment]::SetEnvironmentVariable('FLYWAY_PASSWORD', $previousPassword, 'Process')
}
