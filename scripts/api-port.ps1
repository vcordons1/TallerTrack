<#
Comprobación de arranque y cierre de una sesión de agente (AGENTS.md §4.1 y §8).

  Sin parámetros : informa si hay algo escuchando en el puerto de la API. Sale con 0 si está libre y 1 si está ocupado.
  -Stop          : detiene el proceso que escucha solo si es node.exe; si es otro proceso, no lo toca y sale con 2.
  -Grants        : imprime la migración vigente, la huella de privilegios de TT_APP y los esquemas `TT_TEST_%` que existen
                   (solo lectura, `sqlplus / as sysdba` por autenticación del sistema operativo; no usa ni imprime contraseñas).
                   Al arrancar una sesión, cualquier `TT_TEST_%` es un sobrante de una suite anterior (docs/lecciones.md L24);
                   mientras corre una suite, también aparece el suyo. No cambia el código de salida.

Huella de TT_APP: privilegios de sistema : SELECT : EXECUTE : DML directo : roles : EXECUTE sobre PKG_ORDENES.
Uso (Git Bash o pwsh): powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/api-port.ps1 [-Stop] [-Grants]
#>
param(
    [int]$Port = 3000,
    [switch]$Stop,
    [switch]$Grants,
    [string]$Container = 'XEPDB1',
    [string]$OwnerSchema = 'TT_OWNER',
    [string]$RuntimeUser = 'TT_APP'
)

$ErrorActionPreference = 'Stop'
# Salida en UTF-8 para que acentos y «→» lleguen intactos a Git Bash y pwsh.
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

function Get-Listeners {
    @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique)
}

function Describe-Listeners([int[]]$ProcessIds) {
    foreach ($processId in $ProcessIds) {
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        $name = if ($process) { $process.ProcessName } else { 'desconocido' }
        [pscustomobject]@{ Id = $processId; Name = $name }
    }
}

$exitCode = 0
$listeners = @(Describe-Listeners (Get-Listeners))
if ($listeners.Count -eq 0) {
    Write-Output "Puerto ${Port}: libre."
} else {
    foreach ($listener in $listeners) { Write-Output "Puerto ${Port}: ocupado por PID $($listener.Id) ($($listener.Name))." }
    if (-not $Stop) {
        $exitCode = 1
    } else {
        $foreign = @($listeners | Where-Object { $_.Name -ne 'node' })
        if ($foreign.Count -gt 0) {
            Write-Output "No se detiene: el puerto lo usa un proceso que no es node. Revisa a mano."
            $exitCode = 2
        } else {
            foreach ($listener in $listeners) { Stop-Process -Id $listener.Id -Force }
            Start-Sleep -Milliseconds 500
            if ((Get-Listeners).Count -eq 0) {
                Write-Output "API detenida. Puerto ${Port}: libre."
            } else {
                Write-Output "El puerto ${Port} sigue ocupado tras detener node."
                $exitCode = 2
            }
        }
    }
}

if ($Grants) {
    # Archivo temporal en ASCII para que sqlplus no reciba un BOM por la tubería (ver docs/lecciones.md L12).
    $sqlFile = Join-Path ([IO.Path]::GetTempPath()) ("tt-grants-" + [guid]::NewGuid().ToString('N') + '.sql')
    $sql = @"
set heading off feedback off pagesize 0 verify off linesize 4000 trimout on
whenever sqlerror exit failure
alter session set container=$Container;
select 'MIGRACION='||max("version") keep (dense_rank last order by "installed_rank") from $OwnerSchema."flyway_schema_history" where "success"=1;
select 'TT_APP='||(select count(*) from dba_sys_privs where grantee='$RuntimeUser')
 ||':'||(select count(*) from dba_tab_privs where grantee='$RuntimeUser' and privilege='SELECT')
 ||':'||(select count(*) from dba_tab_privs where grantee='$RuntimeUser' and privilege='EXECUTE')
 ||':'||(select count(*) from dba_tab_privs where grantee='$RuntimeUser' and privilege in ('INSERT','UPDATE','DELETE','MERGE'))
 ||':'||(select count(*) from dba_role_privs where grantee='$RuntimeUser')
 ||':'||(select count(*) from dba_tab_privs where grantee='$RuntimeUser' and table_name='PKG_ORDENES') from dual;
select 'TT_TEST='||nvl(listagg(username||'('||to_char(created,'YYYY-MM-DD')||')', ',') within group (order by created), 'ninguno')
 from dba_users where username like 'TT!_TEST!_%' escape '!';
exit
"@
    try {
        [IO.File]::WriteAllText($sqlFile, $sql, [Text.Encoding]::ASCII)
        $output = & sqlplus -s -L '/ as sysdba' "@$sqlFile" 2>&1 | Out-String
        $sqlExit = $LASTEXITCODE
    } finally {
        Remove-Item -LiteralPath $sqlFile -ErrorAction SilentlyContinue
    }
    $lines = @($output -split "`r?`n" | Where-Object { $_ -match '^(MIGRACION|TT_APP|TT_TEST)=' })
    if ($sqlExit -ne 0 -or $lines.Count -ne 3) {
        Write-Output "No se pudo leer la migración, los privilegios o los esquemas de prueba (sqlplus salió con $sqlExit)."
        if ($exitCode -eq 0) { $exitCode = 3 }
    } else {
        $lines | ForEach-Object { Write-Output $_.Trim() }
        Write-Output "(TT_APP = sistema:SELECT:EXECUTE:DML:roles:PKG_ORDENES; TT_TEST = esquemas de prueba existentes y su fecha de creación)"
    }
}

exit $exitCode
