[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$flyway = Join-Path $repo 'database\scripts\invoke-flyway.ps1'
$ownerBootstrap = Join-Path $repo 'database\scripts\bootstrap-tt-owner.ps1'
$appBootstrap = Join-Path $repo 'database\scripts\bootstrap-tt-app.ps1'
$migrations = Join-Path $repo 'database\migrations'
$sqlplus = (Get-Command sqlplus -ErrorAction Stop).Source
$suffix = [guid]::NewGuid().ToString('N').Substring(0,12).ToUpperInvariant()
$schema = "TT_TEST_$suffix"
$runtime = "TT_TEST_APP_$suffix"
$ownerPassword = "Ow1!$suffix"
$runtimePassword = "Ap1!$suffix"
$ownerCreated = $false
$runtimeCreated = $false
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('tallertrack-t01-' + [guid]::NewGuid().ToString('N'))
$throughV013 = Join-Path $tempRoot 'through-v013'
$saved = @{}
foreach ($name in 'TT_DB_URL','TT_DB_USER','TT_DB_PASSWORD','FLYWAY_LOCATIONS','TT_RUN_T01_ORACLE_INTEGRATION','TT_ORACLE_USER','TT_ORACLE_PASSWORD','TT_ORACLE_CONNECT_STRING','TT_ORACLE_SCHEMA','TT_T01_ACTOR_ID','TT_T01_VEHICLE_ID','TT_T01_PROPERTY_ID','TT_T01_OWNER_ID') {
    $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

function ConvertTo-TestSecureString([string]$Value) {
    $secure = [Security.SecureString]::new()
    foreach ($character in $Value.ToCharArray()) { $secure.AppendChar($character) }
    $secure.MakeReadOnly()
    return $secure
}

function Get-TestRawSql([string]$Value) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        $hex = [BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value))).Replace('-', '')
        return "hextoraw('$hex')"
    } finally { $algorithm.Dispose() }
}

function Invoke-SysSql([string]$Sql) {
    $script = @"
whenever sqlerror exit sql.sqlcode
set echo off verify off feedback off heading off pagesize 0 linesize 1600 trimspool on serveroutput on
alter session set container = XEPDB1;
$Sql
exit
"@
    $output = $script | & $sqlplus -s / as sysdba 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "Oracle SYS operation failed: $output" }
    return $output.Trim()
}

function Invoke-DatabaseSql([string]$User, [string]$Password, [string]$Sql, [bool]$ShouldSucceed = $true) {
    $script = @"
whenever sqlerror exit sql.sqlcode rollback
set echo off verify off feedback off heading off pagesize 0 linesize 1600 trimspool on serveroutput on
$Sql
exit
"@
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = $script | & $sqlplus -s "$User/$Password@127.0.0.1:1521/XEPDB1" 2>&1 | Out-String
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $oldPreference }
    if ($output.Contains($Password)) { throw 'Oracle output exposed a generated password.' }
    if ($ShouldSucceed -and $code -ne 0) { throw "Oracle operation failed: $output" }
    if (-not $ShouldSucceed -and $code -eq 0) { throw "Oracle operation unexpectedly succeeded: $output" }
    return $output.Trim()
}

function Invoke-OwnerSql([string]$Sql, [bool]$ShouldSucceed = $true) {
    return Invoke-DatabaseSql $schema $ownerPassword $Sql $ShouldSucceed
}

function Invoke-RuntimeSql([string]$Sql, [bool]$ShouldSucceed = $true) {
    return Invoke-DatabaseSql $runtime $runtimePassword $Sql $ShouldSucceed
}

function Invoke-Flyway([string]$Command) {
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $flyway $Command 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "Flyway $Command failed: $output" }
    return $output
}

function Assert-Output([string]$Label, [string]$Output, [string]$Pattern) {
    if ($Output -notmatch $Pattern) { throw "$Label failed. Expected /$Pattern/ in: $Output" }
}

function Start-OracleJob([string]$Sql) {
    $script = @"
set echo off verify off feedback off heading off pagesize 0 linesize 1200 trimspool on serveroutput on
$Sql
exit
"@
    return Start-Job -ScriptBlock {
        param($Executable, $Connection, $InputScript)
        $InputScript | & $Executable -s $Connection 2>&1 | Out-String
    } -ArgumentList $sqlplus, "$schema/$ownerPassword@127.0.0.1:1521/XEPDB1", $script
}

function Wait-OracleJobs([object[]]$Jobs) {
    try {
        $outputs = @()
        foreach ($job in $Jobs) { $outputs += (Receive-Job -Job $job -Wait | Out-String).Trim() }
        return $outputs
    } finally {
        foreach ($job in $Jobs) { Remove-Job -Job $job -Force -ErrorAction SilentlyContinue }
    }
}

$hOpen = Get-TestRawSql 't01-open'
$hDifferent = Get-TestRawSql 't01-different'
$hMulti = Get-TestRawSql 't01-multi'
$hReplay = Get-TestRawSql 't01-object-replay'
$hDebt = Get-TestRawSql 't01-debt'
$hDebtNoRepair = Get-TestRawSql 't01-debt-no-repair'
$hRole = Get-TestRawSql 't01-role'
$hProperty = Get-TestRawSql 't01-property'
$hActive = Get-TestRawSql 't01-active'
$hPartial = Get-TestRawSql 't01-partial'
$hRaceA = Get-TestRawSql 't01-race-a'
$hRaceB = Get-TestRawSql 't01-race-b'
$hFileRaceA = Get-TestRawSql 't01-file-race-a'
$hFileRaceB = Get-TestRawSql 't01-file-race-b'

try {
    New-Item -ItemType Directory -Path $throughV013 | Out-Null
    Get-ChildItem -LiteralPath $migrations -Filter '*.sql' |
        Where-Object { $_.Name -match '^V0(0[1-9]|1[0-3])__' } |
        Copy-Item -Destination $throughV013

    & $ownerBootstrap -SchemaName $schema -OwnerPassword (ConvertTo-TestSecureString $ownerPassword) | Out-Null
    $ownerCreated = $true
    $env:TT_DB_URL = 'jdbc:oracle:thin:@//127.0.0.1:1521/XEPDB1'
    $env:TT_DB_USER = $schema
    $env:TT_DB_PASSWORD = $ownerPassword
    $env:FLYWAY_LOCATIONS = 'filesystem:' + $throughV013.Replace('\','/')
    Invoke-Flyway 'migrate' | Out-Null
    Assert-Output 'V013 upgrade base' (Invoke-SysSql "select 'BASE='||count(*) from $schema.`"flyway_schema_history`" where `"success`"=1;") 'BASE=13'
    Remove-Item Env:FLYWAY_LOCATIONS
    Invoke-Flyway 'migrate' | Out-Null
    $second = Invoke-Flyway 'migrate'
    $validate = Invoke-Flyway 'validate'
    Assert-Output 'second migration is idempotent' $second 'Schema .* is up to date|No migration necessary'
    Assert-Output 'current migrations validate' $validate 'Successfully validated 20 migrations'

    $packageEvidence = Invoke-SysSql @"
select 'VALID='||count(*) from all_objects where owner='$schema' and object_name='PKG_ORDENES' and object_type in ('PACKAGE','PACKAGE BODY') and status='VALID';
select 'ERRORS='||count(*) from all_errors where owner='$schema' and name='PKG_ORDENES';
"@
    Assert-Output 'package validity' $packageEvidence 'VALID=2'
    Assert-Output 'package compilation errors' $packageEvidence 'ERRORS=0'

    Invoke-OwnerSql @"
insert into usuario(id_usuario,tipo_actor,login_normalizado,nombre_mostrado,credencial_hash,version_credencial,activo,creado_en,actualizado_en,version_fila)
 values(100,'INTERNO','t01.recepcion','Recepcion T01','TEST_ONLY',1,1,systimestamp,systimestamp,1);
insert into usuario(id_usuario,tipo_actor,login_normalizado,nombre_mostrado,credencial_hash,version_credencial,activo,creado_en,actualizado_en,version_fila)
 values(101,'INTERNO','t01.admin','Admin T01','TEST_ONLY',1,1,systimestamp,systimestamp,1);
insert into usuario(id_usuario,tipo_actor,login_normalizado,nombre_mostrado,credencial_hash,version_credencial,activo,creado_en,actualizado_en,version_fila)
 values(102,'INTERNO','t01.inactivo','Recepcion inactiva','TEST_ONLY',1,0,systimestamp,systimestamp,1);
insert into usuario_rol(id_usuario_rol,id_usuario,codigo_rol,asignado_en,asignado_por) values(1000,100,'RECEPCIONISTA',systimestamp,100);
insert into usuario_rol(id_usuario_rol,id_usuario,codigo_rol,asignado_en,asignado_por) values(1001,101,'ADMINISTRADOR',systimestamp,100);
insert into usuario_rol(id_usuario_rol,id_usuario,codigo_rol,asignado_en,asignado_por) values(1002,102,'RECEPCIONISTA',systimestamp,100);
begin
  for i in 200..205 loop
    insert into cliente(id_cliente,nombre,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
      values(i,'Cliente '||i,1,systimestamp,100,systimestamp,100,1);
  end loop;
end;
/
insert into usuario(id_usuario,tipo_actor,id_cliente,login_normalizado,nombre_mostrado,credencial_hash,version_credencial,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
 values(103,'CLIENTE',200,'t01.cliente','Cliente actor T01','TEST_ONLY',1,1,systimestamp,100,systimestamp,100,1);
insert into usuario_rol(id_usuario_rol,id_usuario,codigo_rol,asignado_en,asignado_por) values(1003,103,'CLIENTE',systimestamp,100);
insert into comando(id_comando,ambito,clave_idempotencia,solicitud_hash,tipo_operacion,id_actor,registrado_en,resultado_codigo)
 values(9000,'fixture/T01','fixture',$hOpen,'PRUEBA_T01',100,systimestamp,200);
begin
  for i in 0..13 loop
    insert into vehiculo(id_vehiculo,codigo_tipo,marca,modelo,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
      values(1000+i,'AUTOMOVIL','Marca','Modelo '||i,case when i=9 then 0 else 1 end,systimestamp,100,systimestamp,100,1);
    insert into propiedad_vehiculo(id_propiedad,id_vehiculo,id_cliente,desde_en,motivo,registrado_por,id_comando)
      values(1100+i,1000+i,case when i=1 then 201 when i=2 then 202 when i=3 then 203 when i=11 then 204 when i=12 then 205 else 200 end,systimestamp-interval '10' day,'Propiedad inicial',100,9000);
  end loop;
end;
/
insert into orden_trabajo(id_orden,id_vehiculo,id_propiedad_apertura,id_cliente,proposito,ingresado_en,kilometraje_ingreso,motivo_ingreso,danos_visibles,estado,listo_en,entregado_en,kilometraje_entrega,entregado_a,entregado_por,version_fila,creado_por,id_comando)
 values(5001,1001,1101,201,'COMERCIAL',systimestamp-interval '2' day,1,'Entrega previa','Sin danos','ENTREGADO',systimestamp-interval '1' day,systimestamp-interval '1' day,2,'Cliente',100,1,100,9000);
insert into orden_trabajo(id_orden,id_vehiculo,id_propiedad_apertura,id_cliente,proposito,ingresado_en,kilometraje_ingreso,motivo_ingreso,danos_visibles,estado,listo_en,entregado_en,kilometraje_entrega,entregado_a,entregado_por,version_fila,creado_por,id_comando)
 values(5002,1002,1102,202,'COMERCIAL',systimestamp-interval '2' day,1,'Entrega previa','Sin danos','ENTREGADO_SIN_REPARACION',systimestamp-interval '1' day,systimestamp-interval '1' day,2,'Cliente',100,1,100,9000);
insert into orden_trabajo(id_orden,id_vehiculo,id_propiedad_apertura,id_cliente,proposito,ingresado_en,kilometraje_ingreso,motivo_ingreso,danos_visibles,estado,version_fila,creado_por,id_comando)
 values(5003,1008,1108,200,'COMERCIAL',systimestamp,1,'Activa previa','Sin danos','RECIBIDO',1,100,9000);
update propiedad_vehiculo set hasta_en=systimestamp-interval '1' second,cerrado_por=100 where id_propiedad=1103;
insert into propiedad_vehiculo(id_propiedad,id_vehiculo,id_cliente,desde_en,motivo,registrado_por,id_predecesora,id_comando)
 values(1203,1003,204,systimestamp,'Transferencia concurrente',100,1103,9000);
commit;
"@ | Out-Null

    & $appBootstrap -RuntimeUser $runtime -OwnerSchema $schema -RuntimePassword (ConvertTo-TestSecureString $runtimePassword) | Out-Null
    $runtimeCreated = $true
    $grants = Invoke-SysSql @"
select 'SELECTS='||count(*) from dba_tab_privs where grantee='$runtime' and owner='$schema' and privilege='SELECT';
select 'EXECUTES='||count(*) from dba_tab_privs where grantee='$runtime' and owner='$schema' and privilege='EXECUTE';
select 'DML='||count(*) from dba_tab_privs where grantee='$runtime' and owner='$schema' and privilege in ('INSERT','UPDATE','DELETE');
"@
    Assert-Output 'runtime readiness reads' $grants 'SELECTS=3'
    Assert-Output 'runtime facade executes' $grants 'EXECUTES=9'
    Assert-Output 'runtime direct DML grants' $grants 'DML=0'
    Assert-Output 'runtime hash read denied' (Invoke-RuntimeSql "select sha256 from $schema.archivo_privado;" $false) 'ORA-00942|ORA-01031'
    Assert-Output 'runtime direct order DML denied' (Invoke-RuntimeSql "delete from $schema.orden_trabajo;" $false) 'ORA-00942|ORA-01031'

    $oneEvidence = '[{"objectKey":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","mimeType":"image/png","sizeBytes":"123","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","intentId":"11111111-1111-4111-8111-111111111111","description":"Frente"}]'
    $success = Invoke-RuntimeSql @"
declare o number; e varchar2(40); v number; c number; p number; ids varchar2(4000); r number;
begin
  $schema.pkg_ordenes.abrir_orden_comercial('actor:100/T01','open-1',$hOpen,100,null,'corr-open-1',1000,1100,200,12345.6,'Revision general','Sin danos visibles',q'~$oneEvidence~',o,e,v,c,p,ids,r);
  commit; dbms_output.put_line('OPEN='||o||':'||e||':'||v||':'||c||':'||p||':'||ids||':'||r);
end;
/
"@
    Assert-Output 'single-evidence opening' $success 'OPEN=\d+:RECIBIDO:1:200:1100:\[\d+\]:0'
    $openedOrder = [long]([regex]::Match($success, 'OPEN=(\d+)').Groups[1].Value)
    $oneFacts = Invoke-OwnerSql @"
select 'FACTS='||(select count(*) from orden_trabajo where id_orden=$openedOrder and id_cliente=200 and id_propiedad_apertura=1100 and id_cita is null and proposito='COMERCIAL' and estado='RECIBIDO' and version_fila=1)
 ||':'||(select count(*) from orden_evento where id_orden=$openedOrder and tipo='APERTURA' and estado_anterior is null and estado_nuevo='RECIBIDO')
 ||':'||(select count(*) from evidencia where id_orden=$openedOrder and contexto='RECEPCION' and visibilidad='CLIENTE_ATENCION')
 ||':'||(select count(*) from comando where ambito='actor:100/T01' and clave_idempotencia='open-1' and resultado_codigo=201)
 ||':'||(select count(*) from auditoria_evento where identificador_recurso=to_char($openedOrder) and accion='ABRIR_ORDEN_COMERCIAL') from dual;
"@
    Assert-Output 'atomic persisted facts' $oneFacts 'FACTS=1:1:1:1:1'

    $retry = Invoke-RuntimeSql @"
declare o number; e varchar2(40); v number; c number; p number; ids varchar2(4000); r number;
begin $schema.pkg_ordenes.abrir_orden_comercial('actor:100/T01','open-1',$hOpen,100,null,'corr-open-1',1000,1100,200,12345.6,'Revision general','Sin danos visibles',q'~$oneEvidence~',o,e,v,c,p,ids,r); commit; dbms_output.put_line('RETRY='||o||':'||ids||':'||r); end;
/
"@
    Assert-Output 'idempotent retry' $retry "RETRY=${openedOrder}:\[\d+\]:1"
    $conflict = Invoke-RuntimeSql @"
declare o number; e varchar2(40); v number; c number; p number; ids varchar2(4000); r number;
begin $schema.pkg_ordenes.abrir_orden_comercial('actor:100/T01','open-1',$hDifferent,100,null,'corr-open-1',1000,1100,200,1,'Otro','Sin danos',q'~$oneEvidence~',o,e,v,c,p,ids,r); end;
/
"@ $false
    Assert-Output 'idempotency conflict' $conflict 'ORA-20002.*CLAVE_REUTILIZADA'

    $multiEvidence = '[{"objectKey":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","mimeType":"image/png","sizeBytes":"124","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","intentId":"22222222-2222-4222-8222-222222222222","description":"Costado"},{"objectKey":"cccccccccccccccccccccccccccccccc","mimeType":"image/jpeg","sizeBytes":"125","sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","intentId":"33333333-3333-4333-8333-333333333333","description":"Parte trasera"}]'
    $multi = Invoke-RuntimeSql @"
declare o number; e varchar2(40); v number; c number; p number; ids varchar2(4000); r number;
begin $schema.pkg_ordenes.abrir_orden_comercial('actor:100/T01','multi',$hMulti,100,null,'corr-multi',1005,1105,200,10,'Recepcion multiple','Sin danos',q'~$multiEvidence~',o,e,v,c,p,ids,r); commit; dbms_output.put_line('MULTI='||o||':'||ids); end;
/
"@
    Assert-Output 'multiple evidence opening' $multi 'MULTI=\d+:\[\d+,\d+\]'

    $replay = Invoke-RuntimeSql @"
declare o number; e varchar2(40); v number; c number; p number; ids varchar2(4000); r number;
begin $schema.pkg_ordenes.abrir_orden_comercial('actor:100/T01','replay',$hReplay,100,null,'corr-replay',1004,1104,200,11,'Replay','Sin danos',q'~$oneEvidence~',o,e,v,c,p,ids,r); end;
/
"@ $false
    Assert-Output 'object replay with a new command' $replay 'ORA-20047.*OBJETO_YA_CONSUMIDO'
    Assert-Output 'replay rollback' (Invoke-OwnerSql "select 'REPLAY_ROWS='||(select count(*) from orden_trabajo where id_vehiculo=1004)||':'||(select count(*) from comando where clave_idempotencia='replay') from dual;") 'REPLAY_ROWS=0:0'

    foreach ($case in @(
        @('delivered debt guard',1001,1101,201,$hDebt,'debt','ORA-20031.*DEUDA_NO_VERIFICABLE'),
        @('delivered without repair debt guard',1002,1102,202,$hDebtNoRepair,'debt-no-repair','ORA-20031.*DEUDA_NO_VERIFICABLE'),
        @('changed property',1003,1103,203,$hProperty,'property','ORA-20021.*PROPIEDAD_CAMBIADA'),
        @('existing active order',1008,1108,200,$hActive,'active','ORA-20030.*ORDEN_ACTIVA_EXISTENTE'),
        @('inactive vehicle',1009,1109,200,$hActive,'inactive','ORA-20014.*VEHICULO_NO_DISPONIBLE')
    )) {
        $owner = $case[3]; $hash = $case[4]; $key = $case[5]
        $out = Invoke-RuntimeSql @"
declare o number; e varchar2(40); v number; c number; p number; ids varchar2(4000); r number;
begin $schema.pkg_ordenes.abrir_orden_comercial('actor:100/T01','$key',$hash,100,null,'corr-$key',$($case[1]),$($case[2]),$owner,1,'Prueba','Sin danos',q'~[{"objectKey":"dddddddddddddddddddddddddddddddd","mimeType":"image/png","sizeBytes":"1","sha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","intentId":"44444444-4444-4444-8444-444444444444","description":"Prueba"}]~',o,e,v,c,p,ids,r); end;
/
"@ $false
        Assert-Output $case[0] $out $case[6]
    }

    foreach ($actorCase in @(@(101,$hRole,'admin-only'),@(102,$hRole,'inactive-actor'),@(103,$hRole,'client-actor'))) {
        $out = Invoke-RuntimeSql @"
declare o number; e varchar2(40); v number; c number; p number; ids varchar2(4000); r number;
begin $schema.pkg_ordenes.abrir_orden_comercial('actor:$($actorCase[0])/T01','$($actorCase[2])',$($actorCase[1]),$($actorCase[0]),null,'corr-role',1006,1106,200,1,'Prueba rol','Sin danos',q'~[{"objectKey":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","mimeType":"image/png","sizeBytes":"1","sha256":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","intentId":"55555555-5555-4555-8555-555555555555","description":"Prueba"}]~',o,e,v,c,p,ids,r); end;
/
"@ $false
        Assert-Output "actor rejection $($actorCase[2])" $out 'ORA-20010|ORA-20011'
    }

    $duplicateEvidence = '[{"objectKey":"ffffffffffffffffffffffffffffffff","mimeType":"image/png","sizeBytes":"1","sha256":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","intentId":"66666666-6666-4666-8666-666666666666","description":"Primera"},{"objectKey":"ffffffffffffffffffffffffffffffff","mimeType":"image/png","sizeBytes":"1","sha256":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","intentId":"66666666-6666-4666-8666-666666666666","description":"Segunda"}]'
    $partial = Invoke-RuntimeSql @"
declare o number; e varchar2(40); v number; c number; p number; ids varchar2(4000); r number;
begin $schema.pkg_ordenes.abrir_orden_comercial('actor:100/T01','partial',$hPartial,100,null,'corr-partial',1006,1106,200,1,'Fallo intermedio','Sin danos',q'~$duplicateEvidence~',o,e,v,c,p,ids,r); end;
/
"@ $false
    Assert-Output 'intermediate evidence failure' $partial 'ORA-20047.*OBJETO_YA_CONSUMIDO'
    Assert-Output 'no partial commit' (Invoke-OwnerSql "select 'PARTIAL='||(select count(*) from orden_trabajo where id_vehiculo=1006)||':'||(select count(*) from archivo_privado where clave_objeto='ffffffffffffffffffffffffffffffff')||':'||(select count(*) from comando where clave_idempotencia='partial') from dual;") 'PARTIAL=0:0:0'

    Invoke-OwnerSql "alter table orden_trabajo add constraint ck_t01_force_order check (id_orden < 0) enable novalidate;" | Out-Null
    $orderFailure = Invoke-RuntimeSql @"
declare o number; e varchar2(40); v number; c number; p number; ids varchar2(4000); r number;
begin $schema.pkg_ordenes.abrir_orden_comercial('actor:100/T01','order-failure',$(Get-TestRawSql 'order-failure'),100,null,'corr-order',1006,1106,200,1,'Fallo orden','Sin danos',q'~[{"objectKey":"15151515151515151515151515151515","mimeType":"image/png","sizeBytes":"1","sha256":"1515151515151515151515151515151515151515151515151515151515151515","intentId":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","description":"Orden"}]~',o,e,v,c,p,ids,r); end;
/
"@ $false
    Assert-Output 'forced order insert failure' $orderFailure 'ORA-02290'
    Invoke-OwnerSql 'alter table orden_trabajo drop constraint ck_t01_force_order;' | Out-Null
    Assert-Output 'order failure rollback' (Invoke-OwnerSql "select 'ORDER_ROLLBACK='||(select count(*) from orden_trabajo where id_vehiculo=1006)||':'||(select count(*) from comando where clave_idempotencia='order-failure') from dual;") 'ORDER_ROLLBACK=0:0'

    Invoke-OwnerSql "alter table orden_evento add constraint ck_t01_force_event check (id_evento_orden < 0) enable novalidate;" | Out-Null
    $eventFailure = Invoke-RuntimeSql @"
declare o number; e varchar2(40); v number; c number; p number; ids varchar2(4000); r number;
begin $schema.pkg_ordenes.abrir_orden_comercial('actor:100/T01','event-failure',$(Get-TestRawSql 'event-failure'),100,null,'corr-event',1006,1106,200,1,'Fallo evento','Sin danos',q'~[{"objectKey":"13131313131313131313131313131313","mimeType":"image/png","sizeBytes":"1","sha256":"1313131313131313131313131313131313131313131313131313131313131313","intentId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","description":"Evento"}]~',o,e,v,c,p,ids,r); end;
/
"@ $false
    Assert-Output 'forced event failure' $eventFailure 'ORA-02290'
    Invoke-OwnerSql 'alter table orden_evento drop constraint ck_t01_force_event;' | Out-Null
    Assert-Output 'event failure rollback' (Invoke-OwnerSql "select 'EVENT_ROLLBACK='||(select count(*) from orden_trabajo where id_vehiculo=1006)||':'||(select count(*) from comando where clave_idempotencia='event-failure') from dual;") 'EVENT_ROLLBACK=0:0'

    $auditFailure = Invoke-RuntimeSql @"
declare o number; e varchar2(40); v number; c number; p number; ids varchar2(4000); r number;
begin $schema.pkg_ordenes.abrir_orden_comercial('actor:100/T01','audit-failure',$(Get-TestRawSql 'audit-failure'),100,null,rpad('x',101,'x'),1007,1107,200,1,'Fallo auditoria','Sin danos',q'~[{"objectKey":"14141414141414141414141414141414","mimeType":"image/png","sizeBytes":"1","sha256":"1414141414141414141414141414141414141414141414141414141414141414","intentId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","description":"Auditoria"}]~',o,e,v,c,p,ids,r); end;
/
"@ $false
    Assert-Output 'forced audit failure' $auditFailure 'ORA-12899'
    Assert-Output 'audit failure rollback' (Invoke-OwnerSql "select 'AUDIT_ROLLBACK='||(select count(*) from orden_trabajo where id_vehiculo=1007)||':'||(select count(*) from archivo_privado where clave_objeto='14141414141414141414141414141414')||':'||(select count(*) from comando where clave_idempotencia='audit-failure') from dual;") 'AUDIT_ROLLBACK=0:0:0'

    $raceEvidenceA = '[{"objectKey":"10101010101010101010101010101010","mimeType":"image/png","sizeBytes":"1","sha256":"1010101010101010101010101010101010101010101010101010101010101010","intentId":"77777777-7777-4777-8777-777777777777","description":"A"}]'
    $raceEvidenceB = '[{"objectKey":"11111111111111111111111111111111","mimeType":"image/png","sizeBytes":"1","sha256":"1111111111111111111111111111111111111111111111111111111111111111","intentId":"88888888-8888-4888-8888-888888888888","description":"B"}]'
    $raceA = Start-OracleJob @"
declare o number; e varchar2(40); v number; c number; p number; ids varchar2(4000); r number;
begin $schema.pkg_ordenes.abrir_orden_comercial('actor:100/T01','race-a',$hRaceA,100,null,'race-a',1010,1110,200,1,'Race A','Sin danos',q'~$raceEvidenceA~',o,e,v,c,p,ids,r); dbms_session.sleep(3); commit; dbms_output.put_line('RACE_A=COMMIT'); exception when others then rollback; dbms_output.put_line('RACE_A='||sqlcode); end;
/
"@
    Start-Sleep -Milliseconds 700
    $raceB = Start-OracleJob @"
declare o number; e varchar2(40); v number; c number; p number; ids varchar2(4000); r number;
begin $schema.pkg_ordenes.abrir_orden_comercial('actor:100/T01','race-b',$hRaceB,100,null,'race-b',1010,1110,200,1,'Race B','Sin danos',q'~$raceEvidenceB~',o,e,v,c,p,ids,r); commit; dbms_output.put_line('RACE_B=COMMIT'); exception when others then rollback; dbms_output.put_line('RACE_B='||sqlcode); end;
/
"@
    $race = Wait-OracleJobs @($raceA,$raceB)
    Assert-Output 'active-order race winner' ($race -join "`n") 'RACE_A=COMMIT'
    Assert-Output 'active-order race loser' ($race -join "`n") 'RACE_B=-20030'

    $sharedEvidence = '[{"objectKey":"12121212121212121212121212121212","mimeType":"image/png","sizeBytes":"1","sha256":"1212121212121212121212121212121212121212121212121212121212121212","intentId":"99999999-9999-4999-8999-999999999999","description":"Compartida"}]'
    $fileA = Start-OracleJob @"
declare o number; e varchar2(40); v number; c number; p number; ids varchar2(4000); r number;
begin $schema.pkg_ordenes.abrir_orden_comercial('actor:100/T01','file-a',$hFileRaceA,100,null,'file-a',1011,1111,204,1,'File A','Sin danos',q'~$sharedEvidence~',o,e,v,c,p,ids,r); dbms_session.sleep(3); commit; dbms_output.put_line('FILE_A=COMMIT'); exception when others then rollback; dbms_output.put_line('FILE_A='||sqlcode); end;
/
"@
    Start-Sleep -Milliseconds 700
    $fileB = Start-OracleJob @"
declare o number; e varchar2(40); v number; c number; p number; ids varchar2(4000); r number;
begin $schema.pkg_ordenes.abrir_orden_comercial('actor:100/T01','file-b',$hFileRaceB,100,null,'file-b',1012,1112,205,1,'File B','Sin danos',q'~$sharedEvidence~',o,e,v,c,p,ids,r); commit; dbms_output.put_line('FILE_B=COMMIT'); exception when others then rollback; dbms_output.put_line('FILE_B='||sqlcode); end;
/
"@
    $fileRace = Wait-OracleJobs @($fileA,$fileB)
    Assert-Output 'object-consumption race winner' ($fileRace -join "`n") 'FILE_A=COMMIT'
    Assert-Output 'object-consumption race loser' ($fileRace -join "`n") 'FILE_B=-20047'

    $env:TT_RUN_T01_ORACLE_INTEGRATION = '1'
    $env:TT_ORACLE_USER = $runtime
    $env:TT_ORACLE_PASSWORD = $runtimePassword
    $env:TT_ORACLE_CONNECT_STRING = '127.0.0.1:1521/XEPDB1'
    $env:TT_ORACLE_SCHEMA = $schema
    $env:TT_T01_ACTOR_ID = '100'
    $env:TT_T01_VEHICLE_ID = '1013'
    $env:TT_T01_PROPERTY_ID = '1113'
    $env:TT_T01_OWNER_ID = '200'
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $nodeOutput = & node --test apps/api/test/open-commercial-order.oracle.integration.test.js 2>&1 | Out-String
        $nodeExit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $oldPreference }
    if ($nodeOutput.Contains($runtimePassword) -or $nodeOutput.Contains($ownerPassword)) { throw 'Node integration output exposed a generated password.' }
    if ($nodeExit -ne 0) { throw "Node/filesystem/Oracle T01 integration failed: $nodeOutput" }
    Assert-Output 'real Node/filesystem/Oracle orchestration' $nodeOutput 'pass 1'
    Assert-Output 'integrated bytes remain outside Oracle' (Invoke-OwnerSql @"
select 'NODE_T01='||(select count(*) from orden_trabajo where id_vehiculo=1013 and estado='RECIBIDO')
 ||':'||(select count(*) from evidencia e join orden_trabajo o on o.id_orden=e.id_orden where o.id_vehiculo=1013 and e.contexto='RECEPCION')
 ||':'||(select count(*) from all_tab_columns where owner='$schema' and table_name in ('ARCHIVO_PRIVADO','EVIDENCIA') and data_type in ('BLOB','BFILE')) from dual;
"@) 'NODE_T01=1:1:0'

    $finalEvidence = Invoke-OwnerSql @"
select 'INVARIANTS='||(select count(*) from orden_trabajo o where not exists(select 1 from evidencia e where e.id_orden=o.id_orden) and o.id_comando<>9000)
 ||':'||(select count(*) from (select clave_objeto from archivo_privado group by clave_objeto having count(*)>1))
 ||':'||(select count(*) from (select id_vehiculo from orden_trabajo where estado in ('RECIBIDO','EN_DIAGNOSTICO','ESPERANDO_AUTORIZACION','EN_REPARACION','LISTO_PARA_ENTREGA','PENDIENTE_ENTREGA_SIN_REPARACION') group by id_vehiculo having count(*)>1))
 ||':'||(select count(*) from comando c where c.tipo_operacion='ABRIR_ORDEN_COMERCIAL' and (c.resultado_codigo<>201 or c.resultado_minimo is null)) from dual;
"@
    Assert-Output 'final invariants' $finalEvidence 'INVARIANTS=0:0:0:0'

    Write-Output 'PASS T01 migration: V013 upgrade, second migrate, Flyway validate, and valid PKG_ORDENES body.'
    Write-Output 'PASS T01 operation: direct COMERCIAL opening persists order, APERTURA event, 1..N reception evidence, command, and audit atomically; real Node/filesystem/Oracle orchestration passed.'
    Write-Output 'PASS T01 guards: exact receptionist role, active actor/vehicle, current expected ownership, active-order exclusion, and conservative delivered-order debt guard.'
    Write-Output 'PASS T01 idempotency/replay: same command returns its order; incompatible key and object reuse fail; intermediate evidence failure leaves no partial facts.'
    Write-Output 'PASS T01 concurrency: independent sessions leave exactly one active order per vehicle and exactly one confirmed consumer per object key.'
    Write-Output 'PASS T01 least privilege: three readiness SELECTs, nine bounded runtime facade EXECUTEs, no direct DML, and no arbitrary file/hash reads.'
    Write-Output "T01_EVIDENCE $($finalEvidence -replace '\s+',' ')"
}
finally {
    Get-Job -ErrorAction SilentlyContinue | Where-Object State -eq 'Running' | Stop-Job -ErrorAction SilentlyContinue
    Get-Job -ErrorAction SilentlyContinue | Remove-Job -Force -ErrorAction SilentlyContinue
    if ($runtimeCreated -and $runtime -match '^TT_TEST_APP_[A-F0-9]{12}$') { Invoke-SysSql "drop user $runtime;" | Out-Null }
    if ($ownerCreated -and $schema -match '^TT_TEST_[A-F0-9]{12}$') { Invoke-SysSql "drop user $schema cascade;" | Out-Null }
    if (Test-Path -LiteralPath $tempRoot) {
        $resolved = (Resolve-Path -LiteralPath $tempRoot).Path
        $systemTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
        if (-not $resolved.StartsWith($systemTemp+'\',[StringComparison]::OrdinalIgnoreCase)) { throw "Refusing to remove $resolved." }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
}
