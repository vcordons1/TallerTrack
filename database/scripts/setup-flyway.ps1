[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$flywayVersion = '13.6.0'
$archiveSha1 = 'e0fcaff40a9719f012724591e6d46a5481160edd'
$archiveName = "flyway-commandline-$flywayVersion-windows-x64.zip"
$archiveUri = "https://download.red-gate.com/maven/release/com/redgate/flyway/flyway-commandline/$flywayVersion/$archiveName"
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$toolsRoot = Join-Path $repositoryRoot '.tools'
$installRoot = Join-Path $toolsRoot "flyway-$flywayVersion"
$flywayExecutable = Join-Path $installRoot 'flyway.cmd'

if (Test-Path -LiteralPath $flywayExecutable -PathType Leaf) {
    Write-Output "Flyway $flywayVersion is already installed in .tools/."
    return
}

if (Test-Path -LiteralPath $installRoot) {
    throw "Incomplete Flyway installation found at '$installRoot'. Remove that exact directory and retry."
}

New-Item -ItemType Directory -Path $toolsRoot -Force | Out-Null
$temporaryArchive = Join-Path ([System.IO.Path]::GetTempPath()) ("tallertrack-$([guid]::NewGuid().ToString('N')).zip")

try {
    Write-Output "Downloading Flyway $flywayVersion from Redgate..."
    $curl = Get-Command 'curl.exe' -ErrorAction SilentlyContinue
    if ($null -ne $curl) {
        & $curl.Source --fail --location --silent --show-error --output $temporaryArchive $archiveUri
        if ($LASTEXITCODE -ne 0) {
            throw "Flyway download failed with curl exit code $LASTEXITCODE."
        }
    }
    else {
        Invoke-WebRequest -Uri $archiveUri -OutFile $temporaryArchive
    }

    $sha1 = [System.Security.Cryptography.SHA1]::Create()
    $archiveStream = [System.IO.File]::OpenRead($temporaryArchive)
    try {
        $actualSha1 = -join ($sha1.ComputeHash($archiveStream) | ForEach-Object { $_.ToString('x2') })
    }
    finally {
        $archiveStream.Dispose()
        $sha1.Dispose()
    }
    if ($actualSha1 -ne $archiveSha1) {
        throw "Flyway archive checksum mismatch. Expected $archiveSha1 but received $actualSha1."
    }

    Expand-Archive -LiteralPath $temporaryArchive -DestinationPath $toolsRoot

    if (-not (Test-Path -LiteralPath $flywayExecutable -PathType Leaf)) {
        throw "The verified Flyway archive did not contain the expected executable at '$flywayExecutable'."
    }

    Write-Output "Flyway $flywayVersion installed in .tools/."
}
finally {
    if (Test-Path -LiteralPath $temporaryArchive -PathType Leaf) {
        Remove-Item -LiteralPath $temporaryArchive -Force
    }
}
