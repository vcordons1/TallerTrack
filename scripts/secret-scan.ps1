<#
Comprobación de secretos (AGENTS.md §9, docs/lecciones.md L11).

Lee los valores secretos de .data/local-credentials/*.txt (líneas `password=…` o `contrasena: …`) y los busca,
como texto literal, en:
  - docs/ (repo de documentación),
  - el vault de Obsidian del proyecto,
  - los archivos *.log del repo de código,
  - los archivos versionados del repo de código (`git ls-files`), excepto .data/.

Solo imprime `cuenta → archivo: N` y un resumen. Nunca imprime un valor. Sale con 1 si hay coincidencias.
Límite: solo conoce los secretos guardados en .data/local-credentials/ (desde TT-031 incluye TT_OWNER y TT_APP;
no incluye admin.local ni recepcion.local). No revisa Oracle.
Uso (Git Bash o pwsh): powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/secret-scan.ps1
#>
param(
    [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$CredentialsDir = '',
    [string]$VaultPath = 'C:\Users\V1k70\Personal\TallerTrack memory',
    # Para probar el script: sustituye los destinos por defecto por estas carpetas.
    [string[]]$Targets = @(),
    [int]$MaxFileBytes = 20MB
)

$ErrorActionPreference = 'Stop'
# Salida en UTF-8 para que acentos y «→» lleguen intactos a Git Bash y pwsh.
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
$repo = (Resolve-Path -LiteralPath $RepoRoot).Path
if (-not $CredentialsDir) { $CredentialsDir = Join-Path $repo '.data\local-credentials' }
$prunedDirectories = @('node_modules', '.git', '.tools', '.data', '.gradle')

function Read-Secrets {
    $secrets = New-Object System.Collections.Generic.List[object]
    foreach ($file in @(Get-ChildItem -LiteralPath $CredentialsDir -Filter '*.txt' -File -ErrorAction SilentlyContinue)) {
        $account = [IO.Path]::GetFileNameWithoutExtension($file.Name)
        foreach ($line in [IO.File]::ReadAllLines($file.FullName)) {
            $match = [regex]::Match($line, '^\s*(password|contrasena|contraseña|clave|secret|token)\s*[:=]\s*(.*?)\s*$', 'IgnoreCase')
            if ($match.Success -and $match.Groups[2].Value.Length -gt 0) {
                $secrets.Add([pscustomobject]@{ Account = $account; Value = $match.Groups[2].Value })
            }
        }
    }
    , $secrets
}

function Get-FilesPruned([string]$Root, [string]$Filter = '*') {
    $pending = New-Object System.Collections.Generic.Stack[string]
    if (Test-Path -LiteralPath $Root -PathType Container) { $pending.Push($Root) }
    while ($pending.Count -gt 0) {
        $directory = $pending.Pop()
        foreach ($item in @(Get-ChildItem -LiteralPath $directory -Force -ErrorAction SilentlyContinue)) {
            if ($item.PSIsContainer) {
                if ($prunedDirectories -notcontains $item.Name) { $pending.Push($item.FullName) }
            } elseif ($item.Name -like $Filter) {
                $item.FullName
            }
        }
    }
}

function Get-ScanFiles {
    $files = New-Object System.Collections.Generic.HashSet[string]([StringComparer]::OrdinalIgnoreCase)
    if ($Targets.Count -gt 0) {
        foreach ($target in $Targets) { Get-FilesPruned $target | ForEach-Object { [void]$files.Add($_) } }
        return , $files
    }
    Get-FilesPruned (Join-Path $repo 'docs') | ForEach-Object { [void]$files.Add($_) }
    Get-FilesPruned $VaultPath | ForEach-Object { [void]$files.Add($_) }
    Get-FilesPruned $repo '*.log' | ForEach-Object { [void]$files.Add($_) }
    $tracked = & git -C $repo ls-files -z 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'git ls-files falló en el repo de código.' }
    foreach ($relative in ($tracked -split "`0")) {
        if (-not $relative -or $relative -like '.data/*') { continue }
        [void]$files.Add((Join-Path $repo ($relative -replace '/', '\')))
    }
    , $files
}

function Count-Occurrences([string]$Text, [string]$Value) {
    $count = 0; $index = 0
    while (($index = $Text.IndexOf($Value, $index, [StringComparison]::Ordinal)) -ge 0) { $count++; $index += $Value.Length }
    $count
}

function Show-Path([string]$Path) {
    foreach ($base in @($repo, $VaultPath)) {
        if ($base -and $Path.StartsWith($base + '\', [StringComparison]::OrdinalIgnoreCase)) {
            $label = if ($base -eq $repo) { '' } else { '[vault] ' }
            return $label + $Path.Substring($base.Length + 1)
        }
    }
    $Path
}

$secrets = Read-Secrets
if ($secrets.Count -eq 0) {
    Write-Output "No hay secretos que buscar en $CredentialsDir."
    exit 0
}

$files = Get-ScanFiles
$hits = 0; $unreadable = 0; $skipped = 0
foreach ($path in $files) {
    try {
        $info = Get-Item -LiteralPath $path -Force -ErrorAction Stop
        if ($info.Length -gt $MaxFileBytes) { $skipped++; continue }
        $text = [IO.File]::ReadAllText($path)
    } catch {
        $unreadable++
        continue
    }
    foreach ($secret in $secrets) {
        $count = Count-Occurrences $text $secret.Value
        if ($count -gt 0) {
            Write-Output "$($secret.Account) → $(Show-Path $path): $count"
            $hits += $count
        }
    }
}

Write-Output "Revisados $($files.Count) archivos con $($secrets.Count) secretos; omitidos por tamaño: $skipped; ilegibles: $unreadable; coincidencias: $hits."
if ($hits -gt 0) { exit 1 }
exit 0
