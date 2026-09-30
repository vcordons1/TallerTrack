[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$ownerBootstrap = Join-Path $repo 'database\scripts\bootstrap-tt-owner.ps1'
$appBootstrap = Join-Path $repo 'database\scripts\bootstrap-tt-app.ps1'
$userBootstrap = Join-Path $repo 'database\scripts\bootstrap-internal-user.ps1'
$flyway = Join-Path $repo 'database\scripts\invoke-flyway.ps1'
$sqlplus = (Get-Command sqlplus -ErrorAction Stop).Source
$suffix = ([guid]::NewGuid().ToString('N').Substring(0,12)).ToUpperInvariant()
$owner = "TT_TEST_$suffix"
$runtimeUser = "TT_TEST_APP_$suffix"
$ownerPassword = "Ow1!$suffix"
$runtimePassword = "Ap1!$suffix"
$internalPassword = "In1!$suffix-secure"
$login = "recepcion.$($suffix.ToLowerInvariant())"
$saved = @{}
$environmentNames = @(
    'TT_DB_URL','TT_DB_USER','TT_DB_PASSWORD','TT_RUN_AUTH_ORACLE_INTEGRATION','TT_RUN_RECEPTION_HTTP_ORACLE_INTEGRATION',
    'TT_ORACLE_USER','TT_ORACLE_PASSWORD','TT_ORACLE_CONNECT_STRING','TT_ORACLE_SCHEMA',
    'TT_ORACLE_EXPECTED_DATABASE','TT_ORACLE_EXPECTED_SERVICE','TT_ORACLE_POOL_MIN','TT_ORACLE_POOL_MAX','TT_ORACLE_POOL_INCREMENT',
    'TT_AUTH_TEST_OWNER','TT_AUTH_TEST_OWNER_PASSWORD','TT_AUTH_TEST_LOGIN','TT_AUTH_TEST_PASSWORD',
    'TT_BOOTSTRAP_ORACLE_USER','TT_BOOTSTRAP_ORACLE_SCHEMA','TT_BOOTSTRAP_ORACLE_PASSWORD','TT_BOOTSTRAP_ORACLE_CONNECT_STRING'
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

function Invoke-OwnerSql([string]$Sql, [bool]$ShouldSucceed = $true) {
    $script = @"
whenever sqlerror exit sql.sqlcode
set echo off verify off feedback off heading off pagesize 0 linesize 500 trimspool on
connect $owner/"$ownerPassword"@//127.0.0.1:1521/XEPDB1
$Sql
exit
"@
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $output = $script | & $sqlplus -s /nolog 2>&1 | Out-String; $code = $LASTEXITCODE }
    finally { $ErrorActionPreference = $oldPreference }
    if ($output.Contains($ownerPassword) -or $output.Contains($internalPassword)) { throw 'Sensitive test output suppressed.' }
    if ($ShouldSucceed -and $code -ne 0) { throw "Owner SQL failed: $output" }
    if (-not $ShouldSucceed -and $code -eq 0) { throw 'Owner SQL unexpectedly succeeded.' }
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

    & $userBootstrap -Login $login -Name 'Recepcion Oracle' -Roles RECEPCIONISTA `
        -Password (ConvertTo-TestSecureString $internalPassword) `
        -OwnerPassword (ConvertTo-TestSecureString $ownerPassword) `
        -OwnerUser $owner -OwnerSchema $owner | Out-Null

    $bootstrapEvidence = Invoke-OwnerSql @"
select 'USER='||count(*) from usuario where login_normalizado='$login' and tipo_actor='INTERNO' and activo=1;
select 'NAME_OK='||count(*) from usuario where login_normalizado='$login' and nombre_mostrado='Recepcion Oracle';
select 'ROLES='||listagg(codigo_rol,',') within group(order by codigo_rol) from usuario_rol ur join usuario u on u.id_usuario=ur.id_usuario where u.login_normalizado='$login' and retirado_en is null;
select 'HASHED='||case when credencial_hash like '`$argon2id`$v=19`$m=65536,p=1,t=3`$%' then 'YES' else 'NO' end from usuario where login_normalizado='$login';
"@
    if ($bootstrapEvidence -notmatch 'USER=1' -or $bootstrapEvidence -notmatch 'NAME_OK=1' -or $bootstrapEvidence -notmatch 'ROLES=RECEPCIONISTA' -or $bootstrapEvidence -notmatch 'HASHED=YES') {
        throw "Unexpected bootstrap evidence: $bootstrapEvidence"
    }

    $env:TT_BOOTSTRAP_ORACLE_USER = $owner
    $env:TT_BOOTSTRAP_ORACLE_SCHEMA = $owner
    $env:TT_BOOTSTRAP_ORACLE_PASSWORD = $ownerPassword
    $env:TT_BOOTSTRAP_ORACLE_CONNECT_STRING = '127.0.0.1:1521/XEPDB1'
    $demoOutput = & node apps/api/scripts/bootstrap-demo-reception.js 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0 -or $demoOutput -notmatch 'Escenario creado: cliente=\d+;.*vehiculo=\d+; propiedad=\d+') {
        throw "Demo reception bootstrap did not create a valid scenario: $demoOutput"
    }
    $demoReplay = & node apps/api/scripts/bootstrap-demo-reception.js 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0 -or $demoReplay -notmatch 'Escenario listo: cliente=\d+;.*vehiculo=\d+; propiedad=\d+') {
        throw "Demo reception bootstrap did not recognize an existing scenario: $demoReplay"
    }
    $demoEvidence = Invoke-OwnerSql @"
select 'DEMO='||count(*) from cliente c join propiedad_vehiculo p on p.id_cliente=c.id_cliente and p.hasta_en is null
 join vehiculo v on v.id_vehiculo=p.id_vehiculo and v.activo=1 join qr_token q on q.id_vehiculo=v.id_vehiculo and q.revocado_en is null
 where c.nit='DEMO-TT022' and c.activo=1 and not exists
 (select 1 from orden_trabajo o where o.id_vehiculo=v.id_vehiculo and o.estado not in ('ENTREGADO','ENTREGADO_SIN_REPARACION','CANCELADO'));
"@
    if ($demoEvidence -notmatch 'DEMO=1') { throw "Demo reception bootstrap scenario is invalid: $demoEvidence" }

    Invoke-OwnerSql @"
declare l_actor number; begin
  select id_usuario into l_actor from usuario where login_normalizado='$login';
  insert into comando(id_comando,ambito,clave_idempotencia,solicitud_hash,tipo_operacion,id_actor,registrado_en,resultado_codigo)
    values(9000,'fixture/HTTP','fixture',hextoraw('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),'PRUEBA_HTTP',l_actor,systimestamp,200);
  for i in 0..2 loop
    insert into cliente(id_cliente,nombre,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
      values(200+i,'Cliente HTTP '||i,1,systimestamp,l_actor,systimestamp,l_actor,1);
    insert into vehiculo(id_vehiculo,codigo_tipo,marca,modelo,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
      values(1000+i,'AUTOMOVIL','Marca HTTP','Modelo '||i,1,systimestamp,l_actor,systimestamp,l_actor,1);
    insert into propiedad_vehiculo(id_propiedad,id_vehiculo,id_cliente,desde_en,motivo,registrado_por,id_comando)
      values(1100+i,1000+i,200+i,systimestamp-interval '1' day,'Propiedad HTTP',l_actor,9000);
    insert into qr_token(id_qr,id_vehiculo,token_hash,emitido_en,emitido_por,id_comando)
      values(1200+i,1000+i,standard_hash('HTTP-QR-'||i,'SHA256'),systimestamp-interval '1' day,l_actor,9000);
  end loop;
  commit;
end;
/
"@ | Out-Null

    $rollbackEvidence = Invoke-OwnerSql @"
delete from rol where codigo_rol='MECANICO';
commit;
declare l_id number; l_hash varchar2(1000); begin
  select credencial_hash into l_hash from usuario where login_normalizado='$login';
  begin
    pkg_identidad_bootstrap.crear_usuario_interno('rollback.$($suffix.ToLowerInvariant())','Rollback Test',l_hash,'["RECEPCIONISTA","MECANICO"]',l_id);
  exception when others then null; end;
  commit;
end;
/
insert into rol(codigo_rol,nombre) values('MECANICO','Mecanico');
commit;
select 'ROLLBACK_USER='||count(*) from usuario where login_normalizado='rollback.$($suffix.ToLowerInvariant())';
"@
    if ($rollbackEvidence -notmatch 'ROLLBACK_USER=0') { throw "Bootstrap partial failure was not atomic: $rollbackEvidence" }

    & $appBootstrap -OwnerSchema $owner -RuntimeUser $runtimeUser -RuntimePassword (ConvertTo-TestSecureString $runtimePassword) | Out-Null
    $runtimeCreated = $true
    $grants = Invoke-SysSql @"
select 'IDENTITY='||count(*) from dba_tab_privs where owner='$owner' and grantee='$runtimeUser' and table_name='PKG_IDENTIDAD' and privilege='EXECUTE';
select 'BOOTSTRAP='||count(*) from dba_tab_privs where owner='$owner' and grantee='$runtimeUser' and table_name='PKG_IDENTIDAD_BOOTSTRAP';
select 'DIRECT_DML='||count(*) from dba_tab_privs where owner='$owner' and grantee='$runtimeUser' and table_name in ('USUARIO','USUARIO_ROL','SESION','TOKEN_ACCESO') and privilege in ('INSERT','UPDATE','DELETE');
"@
    if ($grants -notmatch 'IDENTITY=1' -or $grants -notmatch 'BOOTSTRAP=0' -or $grants -notmatch 'DIRECT_DML=0') {
        throw "Unexpected auth grants: $grants"
    }

    $env:TT_RUN_AUTH_ORACLE_INTEGRATION = '1'
    $env:TT_RUN_RECEPTION_HTTP_ORACLE_INTEGRATION = '1'
    $env:TT_ORACLE_USER = $runtimeUser
    $env:TT_ORACLE_PASSWORD = $runtimePassword
    $env:TT_ORACLE_CONNECT_STRING = '127.0.0.1:1521/XEPDB1'
    $env:TT_ORACLE_SCHEMA = $owner
    $env:TT_ORACLE_EXPECTED_DATABASE = 'XE'
    $env:TT_ORACLE_EXPECTED_SERVICE = 'XEPDB1'
    $env:TT_ORACLE_POOL_MIN = '0'
    $env:TT_ORACLE_POOL_MAX = '4'
    $env:TT_ORACLE_POOL_INCREMENT = '1'
    $env:TT_AUTH_TEST_OWNER = $owner
    $env:TT_AUTH_TEST_OWNER_PASSWORD = $ownerPassword
    $env:TT_AUTH_TEST_LOGIN = $login
    $env:TT_AUTH_TEST_PASSWORD = $internalPassword

    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $receptionOutput = & node --test apps/api/test/reception-http.oracle.integration.test.js 2>&1 | Out-String
        $receptionExitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $oldPreference }
    if ($receptionExitCode -ne 0) { throw "Reception HTTP Oracle tests failed: $receptionOutput" }
    foreach ($secret in $ownerPassword,$runtimePassword,$internalPassword) {
        if ($receptionOutput.Contains($secret)) { throw 'Reception HTTP test output exposed a generated secret.' }
    }

    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $testOutput = & npm.cmd test --workspace apps/api -- --test-name-pattern='I01-I04 use real Oracle' 2>&1 | Out-String
        $testExitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $oldPreference }
    if ($testExitCode -ne 0) { throw "Auth API Oracle tests failed: $testOutput" }
    foreach ($secret in $ownerPassword,$runtimePassword,$internalPassword) {
        if ($testOutput.Contains($secret)) { throw 'Auth test output exposed a generated secret.' }
    }

    Write-Output 'PASS bootstrap: owner-only tool created one real internal RECEPCIONISTA with Argon2id and exact roles; injected role failure rolled back user and roles.'
    Write-Output 'PASS demo bootstrap: explicit owner-only tool created a client, vehicle, current property and QR through T24, then recognized the same eligible scenario.'
    Write-Output 'PASS least privilege: TT_APP executes PKG_IDENTIDAD, cannot execute bootstrap, and has no direct identity DML.'
    Write-Output 'PASS auth HTTP/Oracle: I01-I04, live roles, rotation, reuse-family revocation, two-connection race, logout and deactivation.'
    Write-Output 'PASS reception/query HTTP/Oracle: login, C01/V01/V03 discovery, bounded photo upload, O02, O01/O03, exact bytes, T10 ownership history, keyset cursors, live A/R/M/I roles, revoked session and concurrent O02.'
    Write-Output "ORACLE_EVIDENCE $($bootstrapEvidence -replace '\s+',' ') $($grants -replace '\s+',' ')"
}
catch { $failure = $_ }
finally {
    if ($runtimeCreated) { Invoke-SysSql "drop user $runtimeUser;" | Out-Null }
    if ($ownerCreated) { Invoke-SysSql "drop user $owner cascade;" | Out-Null }
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
}

if ($null -ne $failure) { throw $failure.Exception.Message }
