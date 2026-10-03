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
    'TT_ORACLE_CONNECT_STRING','TT_ORACLE_SCHEMA','TT_RUN_FREE_DIAGNOSTIC_ORACLE_INTEGRATION','FLYWAY_TARGET') {
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
    # Test-only fault injection; the temporary owner is dropped in finally.
    Sys-Sql "grant create trigger to $owner;" | Out-Null
    $env:TT_DB_URL = 'jdbc:oracle:thin:@//127.0.0.1:1521/XEPDB1'
    $env:TT_DB_USER = $owner
    $env:TT_DB_PASSWORD = $ownerPassword
    # TT-028: the suite starts at V022 so the V023 upgrade runs over existing data and grants.
    $env:FLYWAY_TARGET = '022'
    try {
        $migration = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $flyway migrate 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) { throw "Temporary Flyway V022 migration failed: $migration" }
    } finally { Remove-Item Env:FLYWAY_TARGET }

    Owner-Sql @'
insert into usuario(id_usuario,tipo_actor,login_normalizado,nombre_mostrado,credencial_hash,version_credencial,activo,creado_en,actualizado_en,version_fila)
 values(100,'INTERNO','dg.recepcion','Recepcion','TEST_ONLY',1,1,systimestamp,systimestamp,1);
insert into usuario(id_usuario,tipo_actor,login_normalizado,nombre_mostrado,credencial_hash,version_credencial,activo,creado_en,actualizado_en,version_fila)
 values(101,'INTERNO','dg.mecanico1','Mecanico Uno','TEST_ONLY',1,1,systimestamp,systimestamp,1);
insert into usuario(id_usuario,tipo_actor,login_normalizado,nombre_mostrado,credencial_hash,version_credencial,activo,creado_en,actualizado_en,version_fila)
 values(102,'INTERNO','dg.mecanico2','Mecanico Dos','TEST_ONLY',1,1,systimestamp,systimestamp,1);
insert into usuario(id_usuario,tipo_actor,login_normalizado,nombre_mostrado,credencial_hash,version_credencial,activo,creado_en,actualizado_en,version_fila)
 values(103,'INTERNO','dg.admin','Administrador','TEST_ONLY',1,1,systimestamp,systimestamp,1);
insert into usuario(id_usuario,tipo_actor,login_normalizado,nombre_mostrado,credencial_hash,version_credencial,activo,creado_en,actualizado_en,version_fila)
 values(105,'INTERNO','dg.sinrol','Sin rol','TEST_ONLY',1,1,systimestamp,systimestamp,1);
insert into usuario(id_usuario,tipo_actor,login_normalizado,nombre_mostrado,credencial_hash,version_credencial,activo,creado_en,actualizado_en,version_fila)
 values(106,'INTERNO','dg.inactivo','Mecanico Inactivo','TEST_ONLY',1,0,systimestamp,systimestamp,1);
insert into usuario(id_usuario,tipo_actor,login_normalizado,nombre_mostrado,credencial_hash,version_credencial,activo,creado_en,actualizado_en,version_fila)
 values(107,'INTERNO','dg.mecanico3','Mecanico Tres','TEST_ONLY',1,1,systimestamp,systimestamp,1);
insert into usuario(id_usuario,tipo_actor,login_normalizado,nombre_mostrado,credencial_hash,version_credencial,activo,creado_en,actualizado_en,version_fila)
 values(108,'INTERNO','dg.mecanico4','Mecanico Cuatro','TEST_ONLY',1,1,systimestamp,systimestamp,1);
insert into usuario(id_usuario,tipo_actor,login_normalizado,nombre_mostrado,credencial_hash,version_credencial,activo,creado_en,actualizado_en,version_fila)
 values(109,'INTERNO','dg.recepmec','Recepcion Mecanico','TEST_ONLY',1,1,systimestamp,systimestamp,1);
insert into usuario(id_usuario,tipo_actor,login_normalizado,nombre_mostrado,credencial_hash,version_credencial,activo,creado_en,actualizado_en,version_fila)
 values(110,'INTERNO','dg.inventario','Inventario','TEST_ONLY',1,1,systimestamp,systimestamp,1);
insert into cliente(id_cliente,nombre,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
 values(200,'Cliente',1,systimestamp,100,systimestamp,100,1);
insert into usuario(id_usuario,tipo_actor,id_cliente,login_normalizado,nombre_mostrado,credencial_hash,version_credencial,activo,creado_en,actualizado_en,version_fila)
 values(104,'CLIENTE',200,'dg.cliente','Cliente','TEST_ONLY',1,1,systimestamp,systimestamp,1);
insert into usuario_rol(id_usuario,codigo_rol,asignado_en,asignado_por) values(100,'RECEPCIONISTA',systimestamp,100);
insert into usuario_rol(id_usuario,codigo_rol,asignado_en,asignado_por) values(101,'MECANICO',systimestamp,100);
insert into usuario_rol(id_usuario,codigo_rol,asignado_en,asignado_por) values(102,'MECANICO',systimestamp,100);
insert into usuario_rol(id_usuario,codigo_rol,asignado_en,asignado_por) values(103,'ADMINISTRADOR',systimestamp,100);
insert into usuario_rol(id_usuario,codigo_rol,asignado_en,asignado_por) values(104,'CLIENTE',systimestamp,100);
insert into usuario_rol(id_usuario,codigo_rol,asignado_en,asignado_por) values(101,'ADMINISTRADOR',systimestamp,100);
insert into usuario_rol(id_usuario,codigo_rol,asignado_en,asignado_por) values(106,'MECANICO',systimestamp,100);
insert into usuario_rol(id_usuario,codigo_rol,asignado_en,asignado_por) values(107,'MECANICO',systimestamp,100);
insert into usuario_rol(id_usuario,codigo_rol,asignado_en,asignado_por) values(108,'MECANICO',systimestamp,100);
insert into usuario_rol(id_usuario,codigo_rol,asignado_en,asignado_por) values(109,'RECEPCIONISTA',systimestamp,100);
insert into usuario_rol(id_usuario,codigo_rol,asignado_en,asignado_por) values(109,'MECANICO',systimestamp,100);
insert into usuario_rol(id_usuario,codigo_rol,asignado_en,asignado_por) values(110,'INVENTARIO',systimestamp,100);
begin
 for i in 100..110 loop
  insert into sesion(id_sesion,id_usuario,identificador_publico,creada_en,expira_en,version_credencial)
   values(1000+i,i,sys_guid(),systimestamp,systimestamp+interval '1' hour,1);
 end loop;
 -- A second live session of the same receptionist (replay is bound to the session).
 insert into sesion(id_sesion,id_usuario,identificador_publico,creada_en,expira_en,version_credencial)
  values(1200,100,sys_guid(),systimestamp,systimestamp+interval '1' hour,1);
end;
/
insert into comando(id_comando,ambito,clave_idempotencia,solicitud_hash,tipo_operacion,id_actor,registrado_en,resultado_codigo)
 values(500,'fixture/dg','fixture',standard_hash('fixture','SHA256'),'PRUEBA',100,systimestamp,200);
insert into vehiculo(id_vehiculo,codigo_tipo,marca,modelo,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
 values(300,'AUTOMOVIL','Marca','Modelo',1,systimestamp,100,systimestamp,100,1);
insert into vehiculo(id_vehiculo,codigo_tipo,marca,modelo,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
 values(301,'AUTOMOVIL','Marca','Otro',1,systimestamp,100,systimestamp,100,1);
insert into propiedad_vehiculo(id_propiedad,id_vehiculo,id_cliente,desde_en,motivo,registrado_por,id_comando)
 values(400,300,200,systimestamp,'Fixture',100,500);
insert into propiedad_vehiculo(id_propiedad,id_vehiculo,id_cliente,desde_en,motivo,registrado_por,id_comando)
 values(401,301,200,systimestamp,'Fixture',100,500);
insert into vehiculo(id_vehiculo,codigo_tipo,marca,modelo,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
 values(302,'AUTOMOVIL','Marca','Cancelado',1,systimestamp,100,systimestamp,100,1);
insert into vehiculo(id_vehiculo,codigo_tipo,marca,modelo,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
 values(303,'AUTOMOVIL','Marca','Asignacion',1,systimestamp,100,systimestamp,100,1);
insert into propiedad_vehiculo(id_propiedad,id_vehiculo,id_cliente,desde_en,motivo,registrado_por,id_comando)
 values(402,302,200,systimestamp,'Fixture',100,500);
insert into propiedad_vehiculo(id_propiedad,id_vehiculo,id_cliente,desde_en,motivo,registrado_por,id_comando)
 values(403,303,200,systimestamp,'Fixture',100,500);
insert into orden_trabajo(id_orden,id_vehiculo,id_propiedad_apertura,id_cliente,proposito,ingresado_en,kilometraje_ingreso,motivo_ingreso,danos_visibles,estado,version_fila,creado_por,id_comando)
 values(600,300,400,200,'COMERCIAL',systimestamp,100,'Falla','Sin danos','RECIBIDO',1,100,500);
insert into orden_trabajo(id_orden,id_vehiculo,id_propiedad_apertura,id_cliente,proposito,ingresado_en,kilometraje_ingreso,motivo_ingreso,danos_visibles,estado,version_fila,creado_por,id_comando)
 values(601,301,401,200,'COMERCIAL',systimestamp,100,'Otra falla','Sin danos','RECIBIDO',1,100,500);
insert into orden_trabajo(id_orden,id_vehiculo,id_propiedad_apertura,id_cliente,proposito,ingresado_en,kilometraje_ingreso,motivo_ingreso,danos_visibles,estado,motivo_cierre,version_fila,creado_por,id_comando)
 values(602,302,402,200,'COMERCIAL',systimestamp,100,'Cancelada','Sin danos','CANCELADO','PRUEBA',1,100,500);
insert into orden_trabajo(id_orden,id_vehiculo,id_propiedad_apertura,id_cliente,proposito,ingresado_en,kilometraje_ingreso,motivo_ingreso,danos_visibles,estado,version_fila,creado_por,id_comando)
 values(603,303,403,200,'COMERCIAL',systimestamp,100,'Asignacion','Sin danos','RECIBIDO',1,100,500);
insert into trabajo(id_trabajo,id_orden,tipo,tipo_servicio,descripcion,estado,gratuito,creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
 values(700,600,'DIAGNOSTICO','DIAGNOSTICO','Diagnostico cobrable','PROPUESTO',0,systimestamp,101,systimestamp,101,1);
insert into trabajo(id_trabajo,id_orden,tipo,tipo_servicio,descripcion,estado,gratuito,creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
 values(701,600,'REPARACION','MECANICA_GENERAL','Reparacion sin presupuesto','PROPUESTO',0,systimestamp,101,systimestamp,101,1);
insert into trabajo(id_trabajo,id_orden,tipo,tipo_servicio,descripcion,estado,gratuito,creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
 values(702,601,'DIAGNOSTICO','DIAGNOSTICO','Otra orden','PROPUESTO',1,systimestamp,102,systimestamp,102,1);
commit;
'@ | Out-Null

    & $appBootstrap -RuntimeUser $runtime -OwnerSchema $owner -RuntimePassword (As-Secure $runtimePassword) | Out-Null
    $runtimeCreated = $true
    $grants = Sys-Sql "select 'EXECUTES='||count(*) from dba_tab_privs where grantee='$runtime' and owner='$owner' and privilege='EXECUTE';"
    if ($grants -notmatch 'EXECUTES=9') { throw "Runtime facade grants are incomplete: $grants" }
    $privilegeQuery = @"
select 'PRIVS='||(select count(*) from dba_sys_privs where grantee='$runtime')
 ||':'||(select count(*) from dba_tab_privs where grantee='$runtime' and privilege='SELECT')
 ||':'||(select count(*) from dba_tab_privs where grantee='$runtime' and privilege='EXECUTE')
 ||':'||(select count(*) from dba_tab_privs where grantee='$runtime' and privilege in ('INSERT','UPDATE','DELETE','MERGE'))
 ||':'||(select count(*) from dba_role_privs where grantee='$runtime')
 ||':'||(select count(*) from dba_tab_privs where grantee='$runtime' and table_name='PKG_ORDENES') from dual;
"@
    $privilegesBefore = Sys-Sql $privilegeQuery
    # Upgrade V022 -> V023 over the fixtures and the existing runtime grants.
    $upgrade = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $flyway migrate 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "Temporary Flyway V023 upgrade failed: $upgrade" }
    $validate = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $flyway validate 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0 -or $validate -notmatch 'Successfully validated 23 migrations') { throw "Flyway validate failed: $validate" }
    $package = Sys-Sql @"
select 'PACKAGE='||(select count(*) from dba_objects where owner='$owner' and object_name='PKG_DIAGNOSTICO_GRATUITO' and object_type in ('PACKAGE','PACKAGE BODY') and status='VALID')
 ||':'||(select count(*) from dba_errors where owner='$owner' and name='PKG_DIAGNOSTICO_GRATUITO')
 ||':'||(select count(*) from dba_objects where owner='$owner' and status<>'VALID') from dual;
"@
    if ($package -notmatch 'PACKAGE=2:0:0') { throw "V023 package is not valid: $package" }
    $privilegesAfter = Sys-Sql $privilegeQuery
    if ($privilegesBefore -notmatch 'PRIVS=1:3:9:0:0:0' -or $privilegesAfter -ne $privilegesBefore) {
        throw "Runtime privileges changed across V023: $privilegesBefore / $privilegesAfter"
    }
    Write-Output "PASS V022 to V023 upgrade: package valid, 0 invalid objects, TT_APP privileges unchanged ($($privilegesAfter.Trim()))."
    $env:TT_RUN_FREE_DIAGNOSTIC_ORACLE_INTEGRATION = '1'
    $env:TT_ORACLE_USER = $runtime
    $env:TT_ORACLE_PASSWORD = $runtimePassword
    $env:TT_ORACLE_CONNECT_STRING = '127.0.0.1:1521/XEPDB1'
    $env:TT_ORACLE_SCHEMA = $owner
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $nodeOutput = & node --test apps/api/test/free-diagnostic.oracle.integration.test.js 2>&1 | Out-String; $code = $LASTEXITCODE }
    finally { $ErrorActionPreference = $oldPreference }
    if ($nodeOutput.Contains($ownerPassword) -or $nodeOutput.Contains($runtimePassword)) { throw 'Sensitive Node output suppressed.' }
    if ($code -ne 0) { throw "Free diagnostic Oracle integration failed: $nodeOutput" }
    Write-Output $nodeOutput.Trim()
    $facts = Owner-Sql @'
select 'FACTS='||(select count(*) from orden_mecanico where id_orden=600)
 ||':'||(select count(*) from trabajo where id_orden=600)
 ||':'||(select count(*) from trabajo_evento te join trabajo t on t.id_trabajo=te.id_trabajo where t.id_orden=600 and te.tipo='INICIO')
 ||':'||(select count(*) from diagnostico where id_orden=600)
 ||':'||(select count(*) from orden_trabajo where id_orden=600 and estado='EN_DIAGNOSTICO') from dual;
'@
    if ($facts -notmatch 'FACTS=2:4:2:2:1') { throw "Unexpected diagnostic facts: $facts" }
    $invariants = Owner-Sql @'
select 'INVARIANTS='||(select count(*) from trabajo_evento where tipo='INICIO' and (horas_aportadas is not null or costo_interno<>0))
 ||':'||(select count(*) from user_tables where table_name in ('CARGO_ORDEN','PRESUPUESTO','PRESUPUESTO_ITEM'))
 ||':'||(select count(*) from comando where tipo_operacion in ('ASIGNAR_MECANICO','RETIRAR_MECANICO','PROPONER_TRABAJO','INICIAR_TRABAJO','CONFIRMAR_DIAGNOSTICO') and (resultado_minimo is null or resultado_codigo not in (200,201))) from dual;
'@
    if ($invariants -notmatch 'INVARIANTS=0:0:0') { throw "Diagnostic invariant failed: $invariants" }
    # TT-028 assignment facts on order 603: 4 participations (2 current, 2 retired with author
    # and reason), none for users without an active MECANICO role, no pending assignment
    # command, each command with its audit row, order still RECIBIDO without work.
    $assignment = Owner-Sql @'
select 'ASSIGNMENT='||(select count(*) from orden_mecanico where id_orden=603)
 ||':'||(select count(*) from orden_mecanico where id_orden=603 and retirado_en is null)
 ||':'||(select count(*) from orden_mecanico where id_orden=603 and retirado_en is not null and retirado_por is not null and motivo_retiro is not null)
 ||':'||(select count(*) from orden_mecanico where asignado_por is null)
 ||':'||(select count(*) from orden_mecanico where id_mecanico in (105,106))
 ||':'||(select count(*) from orden_mecanico where id_mecanico in (107,108))
 ||':'||(select count(*) from comando c where c.tipo_operacion in ('ASIGNAR_MECANICO','RETIRAR_MECANICO')
      and (c.resultado_minimo is null or not exists (select 1 from auditoria_evento a where a.id_comando=c.id_comando and a.accion=c.tipo_operacion)))
 ||':'||(select count(*) from orden_trabajo where id_orden=603 and estado='RECIBIDO')
 ||':'||(select count(*) from trabajo where id_orden=603) from dual;
'@
    if ($assignment -notmatch 'ASSIGNMENT=4:2:2:0:0:0:0:1:0') { throw "Unexpected assignment facts: $assignment" }
    Write-Output "ORACLE_ASSIGNMENT_EVIDENCE $($assignment -replace '\s+',' ')"
    Write-Output "ORACLE_DIAGNOSTIC_EVIDENCE $($facts -replace '\s+',' ')"
    Write-Output "ORACLE_DIAGNOSTIC_INVARIANTS $($invariants -replace '\s+',' ')"
}
finally {
    if ($runtimeCreated -and $runtime -match '^TT_TEST_APP_[A-F0-9]{12}$') { Sys-Sql "drop user $runtime;" | Out-Null }
    if ($ownerCreated -and $owner -match '^TT_TEST_[A-F0-9]{12}$') { Sys-Sql "drop user $owner cascade;" | Out-Null }
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name,$saved[$name],'Process') }
}
