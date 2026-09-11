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
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('tallertrack-i03-' + [guid]::NewGuid().ToString('N'))
$throughV008 = Join-Path $tempRoot 'through-v008'
$saved = @{}
foreach ($name in 'TT_DB_URL','TT_DB_USER','TT_DB_PASSWORD','FLYWAY_LOCATIONS') {
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
        $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
        $hex = [BitConverter]::ToString($algorithm.ComputeHash($bytes)).Replace('-', '')
        return "hextoraw('$hex')"
    } finally { $algorithm.Dispose() }
}

$hPersonal = Get-TestRawSql 'personal'
$hQr = Get-TestRawSql 'qr'
$hCuenta = Get-TestRawSql 'cuenta'
$hConfirm = Get-TestRawSql 'confirm'
$hReprogram = Get-TestRawSql 'reprogram'
$hAttend = Get-TestRawSql 'attend'
$hReopen = Get-TestRawSql 'reopen'
$hCancel = Get-TestRawSql 'cancel'
$hConfirmPast = Get-TestRawSql 'confirm-past'
$hNoShow = Get-TestRawSql 'no-show'

function Invoke-SysSql([string]$Sql) {
    $script = @"
whenever sqlerror exit sql.sqlcode
set echo off verify off feedback off heading off pagesize 0 linesize 1200 trimspool on serveroutput on
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
set echo off verify off feedback off heading off pagesize 0 linesize 1200 trimspool on serveroutput on
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

function Expect-OracleFailure([string]$Label, [string]$Sql, [string]$Code) {
    $output = Invoke-OwnerSql $Sql $false
    if ($output -notmatch "ORA-$Code") { throw "Expected $Label -> ORA-$Code; actual: $output" }
    Write-Output "PASS negative: $Label -> ORA-$Code"
}

function Assert-Output([string]$Label, [string]$Output, [string]$Pattern) {
    if ($Output -notmatch $Pattern) { throw "$Label failed. Expected /$Pattern/ in: $Output" }
}

function Start-OracleJob([string]$Sql) {
    $script = @"
set echo off verify off feedback off heading off pagesize 0 linesize 1000 trimspool on serveroutput on
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

try {
    New-Item -ItemType Directory -Path $throughV008 | Out-Null
    Get-ChildItem -LiteralPath $migrations -Filter '*.sql' |
        Where-Object { $_.Name -match '^V00[1-8]__' } |
        Copy-Item -Destination $throughV008

    $ownerSecure = ConvertTo-TestSecureString $ownerPassword
    $bootstrapOutput = & $ownerBootstrap -SchemaName $schema -OwnerPassword $ownerSecure 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "Owner bootstrap failed: $bootstrapOutput" }
    $ownerCreated = $true
    $env:TT_DB_URL = 'jdbc:oracle:thin:@//127.0.0.1:1521/XEPDB1'
    $env:TT_DB_USER = $schema
    $env:TT_DB_PASSWORD = $ownerPassword
    $env:FLYWAY_LOCATIONS = 'filesystem:' + $throughV008.Replace('\','/')
    Invoke-Flyway 'migrate' | Out-Null
    Assert-Output 'V008 setup' (Invoke-SysSql "select 'V008_COUNT='||count(*) from $schema.`"flyway_schema_history`" where `"success`"=1;") 'V008_COUNT=8'
    Remove-Item Env:FLYWAY_LOCATIONS
    Invoke-Flyway 'migrate' | Out-Null
    $second = Invoke-Flyway 'migrate'
    $validate = Invoke-Flyway 'validate'
    Assert-Output 'second migrate no-op' $second 'Schema .* is up to date|No migration necessary'
    Assert-Output 'Flyway validation' $validate 'Successfully validated 13 migrations'

    $structure = Invoke-SysSql @"
alter session set current_schema=$schema;
declare
  c number;
  procedure eq(n varchar2, a number, e number) is
  begin if a<>e then raise_application_error(-20190,n||': expected '||e||', got '||a); end if; end;
begin
  select count(*) into c from all_tables where owner='$schema' and table_name in ('CITA','CITA_EVENTO','ORDEN_TRABAJO','ORDEN_EVENTO','ORDEN_MECANICO'); eq('I03 tables',c,5);
  select count(*) into c from all_tables where owner='$schema' and table_name in ('ARCHIVO_PRIVADO','EVIDENCIA'); eq('G03B tables',c,2);
  select count(*) into c from all_constraints where owner='$schema' and table_name in ('CITA','CITA_EVENTO','ORDEN_TRABAJO','ORDEN_EVENTO','ORDEN_MECANICO') and status<>'ENABLED'; eq('disabled constraints',c,0);
  select count(*) into c from all_constraints where owner='$schema' and constraint_name in ('FK_CITA_QR_VEHICULO','FK_ORDEN_PROPIEDAD','FK_ORDEN_CITA_VEHICULO','UQ_ORDEN_CITA','CK_CITA_EVENTO_SEMANTICA') and status='ENABLED'; eq('critical constraints',c,5);
  select count(*) into c from all_indexes where owner='$schema' and index_name in ('UQ_ORDEN_ACTIVA_VEHICULO','UQ_ORDEN_MECANICO_ABIERTO') and uniqueness='UNIQUE' and status='VALID'; eq('conditional indexes',c,2);
  select count(*) into c from all_objects where owner='$schema' and object_name='PKG_AGENDA' and object_type in ('PACKAGE','PACKAGE BODY') and status='VALID'; eq('agenda package',c,2);
  select count(*) into c from all_errors where owner='$schema' and name='PKG_AGENDA'; eq('package errors',c,0);
  dbms_output.put_line('STRUCTURE_OK');
end;
/
select 'STRUCTURE_OK' from dual;
"@
    Assert-Output 'I03 structure' $structure 'STRUCTURE_OK'

    Invoke-OwnerSql @"
insert into usuario(id_usuario,tipo_actor,login_normalizado,nombre_mostrado,credencial_hash,version_credencial,activo,creado_en,actualizado_en,version_fila)
 values(100,'INTERNO','i03.recepcion','Recepcion I03','TEST_ONLY',1,1,systimestamp,systimestamp,1);
insert into usuario(id_usuario,tipo_actor,login_normalizado,nombre_mostrado,credencial_hash,version_credencial,activo,creado_en,actualizado_en,version_fila)
 values(101,'INTERNO','i03.mecanico','Mecanico I03','TEST_ONLY',1,1,systimestamp,systimestamp,1);
insert into cliente(id_cliente,nombre,telefono,email,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
 values(200,'Cliente contractual','55550000','cliente@example.test',1,systimestamp,100,systimestamp,100,1);
insert into cliente(id_cliente,nombre,telefono,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
 values(201,'Cliente posterior','55551111',1,systimestamp,100,systimestamp,100,1);
insert into usuario(id_usuario,tipo_actor,id_cliente,login_normalizado,nombre_mostrado,credencial_hash,version_credencial,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
 values(102,'CLIENTE',200,'i03.cliente','Cliente I03','TEST_ONLY',1,1,systimestamp,100,systimestamp,100,1);
insert into usuario_rol(id_usuario_rol,id_usuario,codigo_rol,asignado_en,asignado_por) values(300,100,'RECEPCIONISTA',systimestamp,100);
insert into usuario_rol(id_usuario_rol,id_usuario,codigo_rol,asignado_en,asignado_por) values(301,101,'MECANICO',systimestamp,100);
insert into usuario_rol(id_usuario_rol,id_usuario,codigo_rol,asignado_en,asignado_por) values(302,102,'CLIENTE',systimestamp,100);
insert into sesion(id_sesion,id_usuario,identificador_publico,creada_en,expira_en,version_credencial)
 values(400,100,hextoraw('00112233445566778899AABBCCDDEEFF'),systimestamp,systimestamp+interval '2' hour,1);
insert into sesion(id_sesion,id_usuario,identificador_publico,creada_en,expira_en,version_credencial)
 values(401,102,hextoraw('10112233445566778899AABBCCDDEEFF'),systimestamp,systimestamp+interval '2' hour,1);
insert into comando(id_comando,ambito,clave_idempotencia,solicitud_hash,tipo_operacion,id_actor,registrado_en,resultado_codigo)
 values(9000,'fixture/I03','fixture',standard_hash('fixture-i03','SHA256'),'PRUEBA_I03',100,systimestamp,200);
insert into vehiculo(id_vehiculo,codigo_tipo,placa,vin,marca,modelo,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
 values(1000,'AUTOMOVIL','I03-A','I03-VIN-A','Marca','Modelo A',1,systimestamp,100,systimestamp,100,1);
insert into vehiculo(id_vehiculo,codigo_tipo,placa,vin,marca,modelo,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
 values(1001,'AUTOMOVIL','I03-B','I03-VIN-B','Marca','Modelo B',1,systimestamp,100,systimestamp,100,1);
insert into propiedad_vehiculo(id_propiedad,id_vehiculo,id_cliente,desde_en,motivo,registrado_por,id_comando)
 values(1100,1000,200,systimestamp-interval '1' day,'Propiedad inicial',100,9000);
insert into propiedad_vehiculo(id_propiedad,id_vehiculo,id_cliente,desde_en,motivo,registrado_por,id_comando)
 values(1101,1001,200,systimestamp-interval '1' day,'Propiedad inicial',100,9000);
insert into qr_token(id_qr,id_vehiculo,token_hash,emitido_en,emitido_por,id_comando)
 values(1200,1000,standard_hash('i03-qr-a','SHA256'),systimestamp,100,9000);
insert into qr_token(id_qr,id_vehiculo,token_hash,emitido_en,emitido_por,id_comando)
 values(1201,1001,standard_hash('i03-qr-b','SHA256'),systimestamp,100,9000);
commit;
"@ | Out-Null

    $appSecure = ConvertTo-TestSecureString $runtimePassword
    $appOutput = & $appBootstrap -RuntimeUser $runtime -OwnerSchema $schema -RuntimePassword $appSecure 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "Runtime bootstrap failed: $appOutput" }
    $runtimeCreated = $true
    $grants = Invoke-SysSql @"
select 'SYS='||listagg(privilege,',') within group(order by privilege) from dba_sys_privs where grantee='$runtime';
select 'SELECTS='||count(*) from dba_tab_privs where grantee='$runtime' and owner='$schema' and privilege='SELECT';
select 'EXECUTES='||count(*) from dba_tab_privs where grantee='$runtime' and owner='$schema' and privilege='EXECUTE';
select 'DML='||count(*) from dba_tab_privs where grantee='$runtime' and owner='$schema' and privilege in ('INSERT','UPDATE','DELETE');
select 'QUOTA='||count(*) from dba_ts_quotas where username='$runtime' and max_bytes<>0;
"@
    Assert-Output 'runtime grants' $grants 'SYS=CREATE SESSION'
    Assert-Output 'runtime select count' $grants 'SELECTS=3'
    Assert-Output 'runtime execute count' $grants 'EXECUTES=2'
    Assert-Output 'runtime direct DML grants' $grants 'DML=0'
    Assert-Output 'runtime quota' $grants 'QUOTA=0'
    Assert-Output 'runtime history update denied' (Invoke-RuntimeSql "update $schema.cita_evento set motivo='X';" $false) 'ORA-00942|ORA-01031'
    Assert-Output 'runtime history delete denied' (Invoke-RuntimeSql "delete from $schema.orden_evento;" $false) 'ORA-00942|ORA-01031'
    Assert-Output 'runtime table select denied' (Invoke-RuntimeSql "select * from $schema.orden_trabajo;" $false) 'ORA-00942|ORA-01031'

    $agenda = Invoke-RuntimeSql @"
declare c1 number; c2 number; c3 number; v number; r number;
begin
  $schema.pkg_agenda.solicitar_cita('actor:100/I03','personal',$hPersonal,100,400,'corr-personal',1000,'PERSONAL',null,'Solicitante presencial','55552222','Revision presencial',systimestamp+interval '1' day,c1,v,r);
  dbms_output.put_line('PERSONAL='||c1||':'||v||':'||r);
  $schema.pkg_agenda.solicitar_cita('public:1200/I03','qr',$hQr,null,null,'corr-qr',1000,'QR',1200,'Solicitante QR','qr@example.test','Revision QR',systimestamp+interval '2' day,c2,v,r);
  dbms_output.put_line('QR='||c2||':'||v||':'||r);
  $schema.pkg_agenda.solicitar_cita('actor:102/I03','cuenta',$hCuenta,102,401,'corr-cuenta',1000,'CUENTA',null,null,null,'Revision cuenta',systimestamp+interval '3' day,c3,v,r);
  dbms_output.put_line('CUENTA='||c3||':'||v||':'||r);
  commit;
end;
/
"@
    Assert-Output 'PERSONAL request' $agenda 'PERSONAL=\d+:1:0'
    Assert-Output 'QR request' $agenda 'QR=\d+:1:0'
    Assert-Output 'CUENTA request' $agenda 'CUENTA=\d+:1:0'
    $citaIds = Invoke-OwnerSql "select 'CITAS='||listagg(id_cita,':') within group(order by id_cita) from cita;"
    if ($citaIds -notmatch 'CITAS=(\d+):(\d+):(\d+)') { throw "Could not resolve citation IDs: $citaIds" }
    $personalCita = [long]$Matches[1]
    $qrCita = [long]$Matches[2]
    $accountCita = [long]$Matches[3]

    $variantEvidence = Invoke-OwnerSql @"
select 'VARIANTS='||
 (select count(*) from cita where origen='PERSONAL' and id_usuario_solicita is null and id_qr_origen is null)||':'||
 (select count(*) from cita where origen='QR' and id_usuario_solicita is null and id_qr_origen=1200)||':'||
 (select count(*) from cita where origen='CUENTA' and id_usuario_solicita=102 and id_qr_origen is null and nombre_solicitante='Cliente contractual' and contacto_solicitante='cliente@example.test')||':'||
 (select count(*) from cita_evento where tipo='SOLICITUD')||':'||
 (select count(*) from cita_evento where tipo='SOLICITUD' and registrado_por is null)
from dual;
"@
    Assert-Output 'appointment variants and actors' $variantEvidence 'VARIANTS=1:1:1:3:1'

    Expect-OracleFailure 'CUENTA without account user' "insert into cita(id_vehiculo,origen,nombre_solicitante,contacto_solicitante,motivo,solicitada_en,inicio_solicitado,estado,version_fila) values(1000,'CUENTA','X','Y','Z',systimestamp,systimestamp,'SOLICITADA',1);" '02290'
    Expect-OracleFailure 'QR with account user' "insert into cita(id_vehiculo,origen,id_usuario_solicita,id_qr_origen,nombre_solicitante,contacto_solicitante,motivo,solicitada_en,inicio_solicitado,estado,version_fila) values(1000,'QR',102,1200,'X','Y','Z',systimestamp,systimestamp,'SOLICITADA',1);" '02290'
    Expect-OracleFailure 'PERSONAL with QR' "insert into cita(id_vehiculo,origen,id_qr_origen,nombre_solicitante,contacto_solicitante,motivo,solicitada_en,inicio_solicitado,estado,version_fila) values(1000,'PERSONAL',1200,'X','Y','Z',systimestamp,systimestamp,'SOLICITADA',1);" '02290'
    Expect-OracleFailure 'unknown appointment state' "insert into cita(id_vehiculo,origen,nombre_solicitante,contacto_solicitante,motivo,solicitada_en,inicio_solicitado,estado,version_fila) values(1000,'PERSONAL','X','Y','Z',systimestamp,systimestamp,'REPROGRAMADA',1);" '02290'
    Expect-OracleFailure 'confirmed appointment without valid range' "insert into cita(id_vehiculo,origen,nombre_solicitante,contacto_solicitante,motivo,solicitada_en,inicio_solicitado,inicio_programado,fin_programado,estado,version_fila) values(1000,'PERSONAL','X','Y','Z',systimestamp,systimestamp,systimestamp,systimestamp,'CONFIRMADA',1);" '02290'
    Expect-OracleFailure 'QR from another vehicle' "insert into cita(id_vehiculo,origen,id_qr_origen,nombre_solicitante,contacto_solicitante,motivo,solicitada_en,inicio_solicitado,estado,version_fila) values(1001,'QR',1200,'X','Y','Z',systimestamp,systimestamp,'SOLICITADA',1);" '02291'
    Expect-OracleFailure 'invented appointment transition' "insert into cita_evento(id_cita,tipo,estado_anterior,estado_nuevo,motivo,registrado_en,registrado_por,id_comando) values($personalCita,'ESTADO','CANCELADA','SOLICITADA','Reabrir',systimestamp,100,9000);" '02290'

    $lifecycle = Invoke-RuntimeSql @"
declare v number; r number;
begin
  $schema.pkg_agenda.confirmar_cita('actor:100/I03','confirm',$hConfirm,100,400,'corr-confirm',$personalCita,1,systimestamp+interval '1' day,systimestamp+interval '1' day+interval '1' hour,'Horario confirmado',v,r);
  $schema.pkg_agenda.reprogramar_cita('actor:100/I03','reprogram',$hReprogram,100,400,'corr-reprogram',$personalCita,v,systimestamp+interval '2' day,systimestamp+interval '2' day+interval '1' hour,'Cambio solicitado',v,r);
  $schema.pkg_agenda.atender_sin_orden('actor:100/I03','attend',$hAttend,100,400,'corr-attend',$personalCita,v,'Atencion sin orden',v,r);
  dbms_output.put_line('FINAL_VERSION='||v);
  commit;
end;
/
"@
    Assert-Output 'appointment lifecycle' $lifecycle 'FINAL_VERSION=4'
    $remainingStates = Invoke-RuntimeSql @"
declare v number; r number;
begin
  $schema.pkg_agenda.cancelar_cita('actor:100/I03','cancel',$hCancel,100,400,'corr-cancel',$qrCita,1,'Solicitud cancelada',v,r);
  $schema.pkg_agenda.confirmar_cita('actor:100/I03','confirm-past',$hConfirmPast,100,400,'corr-confirm-past',$accountCita,1,systimestamp-interval '2' hour,systimestamp-interval '1' hour,'Horario transcurrido',v,r);
  $schema.pkg_agenda.registrar_inasistencia('actor:100/I03','no-show',$hNoShow,100,400,'corr-no-show',$accountCita,v,'No asistio',v,r);
  dbms_output.put_line('OTHER_FINALS='||v);
  commit;
end;
/
"@
    Assert-Output 'cancellation and no-show lifecycle' $remainingStates 'OTHER_FINALS=3'
    $reopen = Invoke-RuntimeSql @"
declare v number; r number;
begin
  begin
    $schema.pkg_agenda.reprogramar_cita('actor:100/I03','reopen',$hReopen,100,400,'corr-reopen',$personalCita,4,systimestamp+interval '3' day,null,'No reabrir',v,r);
  exception when others then dbms_output.put_line('REOPEN='||sqlcode); end;
  rollback;
end;
/
"@
    Assert-Output 'final appointment cannot reopen' $reopen 'REOPEN=-20023'
    Assert-Output 'typed appointment history' (Invoke-OwnerSql "select 'HISTORY='||(select count(*) from cita_evento where id_cita=$personalCita)||':'||(select count(*) from cita_evento where id_cita=$personalCita and tipo='REPROGRAMACION' and estado_anterior=estado_nuevo and inicio_anterior is not null and inicio_nuevo is not null) from dual;") 'HISTORY=4:1'
    Assert-Output 'all five canonical appointment states in typed history' (Invoke-OwnerSql "select 'EVENT_STATES='||count(distinct estado_nuevo) from cita_evento;") 'EVENT_STATES=5'

    Invoke-OwnerSql @"
insert into orden_trabajo(id_orden,id_vehiculo,id_propiedad_apertura,id_cliente,id_cita,proposito,ingresado_en,kilometraje_ingreso,motivo_ingreso,danos_visibles,estado,version_fila,creado_por,id_comando)
 values(2000,1000,1100,200,$personalCita,'COMERCIAL',systimestamp,12345.6,'Revision general','Sin danos visibles','RECIBIDO',1,100,9000);
insert into orden_evento(id_evento_orden,id_orden,tipo,estado_nuevo,motivo,registrado_en,registrado_por,id_comando)
 values(2100,2000,'APERTURA','RECIBIDO','Apertura estructural',systimestamp,100,9000);
commit;
"@ | Out-Null
    Expect-OracleFailure 'wrong opening owner triple' "insert into orden_trabajo(id_vehiculo,id_propiedad_apertura,id_cliente,proposito,ingresado_en,kilometraje_ingreso,motivo_ingreso,danos_visibles,estado,version_fila,creado_por,id_comando) values(1000,1100,201,'COMERCIAL',systimestamp,1,'X','X','CANCELADO',1,100,9000);" '02291'
    Expect-OracleFailure 'appointment from another vehicle' "insert into orden_trabajo(id_vehiculo,id_propiedad_apertura,id_cliente,id_cita,proposito,ingresado_en,kilometraje_ingreso,motivo_ingreso,danos_visibles,estado,version_fila,creado_por,id_comando) values(1001,1101,200,$qrCita,'COMERCIAL',systimestamp,1,'X','X','CANCELADO',1,100,9000);" '02291'
    Expect-OracleFailure 'same appointment in two orders' "insert into orden_trabajo(id_vehiculo,id_propiedad_apertura,id_cliente,id_cita,proposito,ingresado_en,kilometraje_ingreso,motivo_ingreso,danos_visibles,estado,version_fila,creado_por,id_comando) values(1000,1100,200,$personalCita,'COMERCIAL',systimestamp,1,'X','X','CANCELADO',1,100,9000);" '00001'
    Expect-OracleFailure 'second active order' "insert into orden_trabajo(id_vehiculo,id_propiedad_apertura,id_cliente,proposito,ingresado_en,kilometraje_ingreso,motivo_ingreso,danos_visibles,estado,version_fila,creado_por,id_comando) values(1000,1100,200,'COMERCIAL',systimestamp,1,'X','X','LISTO_PARA_ENTREGA',1,100,9000);" '00001'
    Expect-OracleFailure 'negative entry mileage' "insert into orden_trabajo(id_vehiculo,id_propiedad_apertura,id_cliente,proposito,ingresado_en,kilometraje_ingreso,motivo_ingreso,danos_visibles,estado,version_fila,creado_por,id_comando) values(1001,1101,200,'COMERCIAL',systimestamp,-0.1,'X','X','CANCELADO',1,100,9000);" '02290'
    Expect-OracleFailure 'invalid purpose' "insert into orden_trabajo(id_vehiculo,id_propiedad_apertura,id_cliente,proposito,ingresado_en,kilometraje_ingreso,motivo_ingreso,danos_visibles,estado,version_fila,creado_por,id_comando) values(1001,1101,200,'MANTENIMIENTO',systimestamp,1,'X','X','CANCELADO',1,100,9000);" '02290'
    Expect-OracleFailure 'invalid order state' "insert into orden_trabajo(id_vehiculo,id_propiedad_apertura,id_cliente,proposito,ingresado_en,kilometraje_ingreso,motivo_ingreso,danos_visibles,estado,version_fila,creado_por,id_comando) values(1001,1101,200,'COMERCIAL',systimestamp,1,'X','X','CERRADO',1,100,9000);" '02290'

    Invoke-OwnerSql @"
update orden_trabajo set estado='CANCELADO',motivo_cierre='APERTURA_ERRONEA',version_fila=2 where id_orden=2000;
insert into orden_trabajo(id_orden,id_vehiculo,id_propiedad_apertura,id_cliente,proposito,ingresado_en,kilometraje_ingreso,motivo_ingreso,danos_visibles,estado,motivo_cierre,version_fila,creado_por,id_comando)
 values(2001,1000,1100,200,'COMERCIAL',systimestamp,10,'Historica 2','Sin danos','CANCELADO','APERTURA_ERRONEA',1,100,9000);
insert into orden_trabajo(id_orden,id_vehiculo,id_propiedad_apertura,id_cliente,proposito,ingresado_en,kilometraje_ingreso,motivo_ingreso,danos_visibles,estado,listo_en,entregado_en,kilometraje_entrega,entregado_a,entregado_por,version_fila,creado_por,id_comando)
 values(2002,1000,1100,200,'COMERCIAL',systimestamp,20,'Historica 3','Sin danos','ENTREGADO',systimestamp,systimestamp,21,'Cliente contractual',100,1,100,9000);
update propiedad_vehiculo set hasta_en=systimestamp,cerrado_por=100 where id_propiedad=1100;
insert into propiedad_vehiculo(id_propiedad,id_vehiculo,id_cliente,desde_en,motivo,registrado_por,id_predecesora,id_comando)
 values(1102,1000,201,systimestamp,'Transferencia posterior',100,1100,9000);
commit;
"@ | Out-Null
    Assert-Output 'historical orders allowed and client frozen' (Invoke-OwnerSql "select 'HISTORY='||count(*)||':'||min(id_cliente)||':'||max(id_cliente) from orden_trabajo where id_vehiculo=1000;") 'HISTORY=3:200:200'

    Invoke-OwnerSql @"
insert into orden_mecanico(id_participacion,id_orden,id_mecanico,asignado_en,asignado_por)
 values(3000,2000,101,systimestamp,100);
commit;
"@ | Out-Null
    Expect-OracleFailure 'duplicate open mechanic participation' "insert into orden_mecanico(id_orden,id_mecanico,asignado_en,asignado_por) values(2000,101,systimestamp,100);" '00001'
    Invoke-OwnerSql @"
update orden_mecanico set retirado_en=systimestamp,retirado_por=100,motivo_retiro='Rotacion' where id_participacion=3000;
insert into orden_mecanico(id_participacion,id_orden,id_mecanico,asignado_en,asignado_por)
 values(3001,2000,101,systimestamp,100);
commit;
"@ | Out-Null
    Assert-Output 'historical mechanic participation' (Invoke-OwnerSql "select 'PARTICIPATIONS='||count(*)||':'||sum(case when retirado_en is null then 1 else 0 end) from orden_mecanico where id_orden=2000 and id_mecanico=101;") 'PARTICIPATIONS=2:1'
    Expect-OracleFailure 'unknown mechanic user' "insert into orden_mecanico(id_orden,id_mecanico,asignado_en,asignado_por) values(2000,999999,systimestamp,100);" '02291'

    $raceA = Start-OracleJob @"
begin
  insert into orden_trabajo(id_vehiculo,id_propiedad_apertura,id_cliente,proposito,ingresado_en,kilometraje_ingreso,motivo_ingreso,danos_visibles,estado,version_fila,creado_por,id_comando)
   values(1001,1101,200,'COMERCIAL',systimestamp,50,'Carrera A','Sin danos','RECIBIDO',1,100,9000);
  dbms_session.sleep(3); commit; dbms_output.put_line('ORDER_A=COMMIT');
exception when others then rollback; dbms_output.put_line('ORDER_A='||sqlcode); end;
/
"@
    Start-Sleep -Milliseconds 700
    $raceB = Start-OracleJob @"
begin
  insert into orden_trabajo(id_vehiculo,id_propiedad_apertura,id_cliente,proposito,ingresado_en,kilometraje_ingreso,motivo_ingreso,danos_visibles,estado,version_fila,creado_por,id_comando)
   values(1001,1101,200,'COMERCIAL',systimestamp,51,'Carrera B','Sin danos','EN_DIAGNOSTICO',1,100,9000);
  commit; dbms_output.put_line('ORDER_B=COMMIT');
exception when others then rollback; dbms_output.put_line('ORDER_B='||sqlcode); end;
/
"@
    $race = Wait-OracleJobs @($raceA,$raceB)
    Assert-Output 'active order race winner' ($race -join "`n") 'ORDER_A=COMMIT'
    Assert-Output 'active order race loser' ($race -join "`n") 'ORDER_B=-1'
    Assert-Output 'active order race final state' (Invoke-OwnerSql "select 'ACTIVE_ORDERS='||count(*) from orden_trabajo where id_vehiculo=1001 and estado in ('RECIBIDO','EN_DIAGNOSTICO','ESPERANDO_AUTORIZACION','EN_REPARACION','LISTO_PARA_ENTREGA','PENDIENTE_ENTREGA_SIN_REPARACION');") 'ACTIVE_ORDERS=1'

    $evidence = Invoke-OwnerSql @"
select 'WRONG_OWNER='||count(*) from orden_trabajo o left join propiedad_vehiculo p on p.id_propiedad=o.id_propiedad_apertura and p.id_vehiculo=o.id_vehiculo and p.id_cliente=o.id_cliente where p.id_propiedad is null;
select 'WRONG_CITA='||count(*) from orden_trabajo o join cita c on c.id_cita=o.id_cita where c.id_vehiculo<>o.id_vehiculo;
select 'DUP_ACTIVE='||count(*) from (select id_vehiculo from orden_trabajo where estado in ('RECIBIDO','EN_DIAGNOSTICO','ESPERANDO_AUTORIZACION','EN_REPARACION','LISTO_PARA_ENTREGA','PENDIENTE_ENTREGA_SIN_REPARACION') group by id_vehiculo having count(*)>1);
"@
    Assert-Output 'final critical invariants' $evidence 'WRONG_OWNER=0'
    Assert-Output 'final appointment vehicle invariant' $evidence 'WRONG_CITA=0'
    Assert-Output 'final active-order invariant' $evidence 'DUP_ACTIVE=0'

    Write-Output 'PASS I03 migrations: upgrade V008->current, second migrate no-op, and Flyway validate green; aggregate foundation covers clean V001->current.'
    Write-Output 'PASS I03 appointments: CUENTA/QR/PERSONAL variants, exact states, typed immutable history, optimistic versioning, reprogramming, and final-state rejection.'
    Write-Output 'PASS I03 orders: opening ownership triple, appointment vehicle, single appointment use, exact states/purpose/mileage, frozen contractual client, and multiple final histories.'
    Write-Output 'PASS I03 mechanics: one open participation per order/mechanic, historical reassignment, and user FK.'
    Write-Output 'PASS I03 concurrency: two independent Oracle sessions forced simultaneous active-order inserts; one committed, one received ORA-00001, one active row remained.'
    Write-Output 'PASS I03 runtime security: TT_APP analogue has only three readiness SELECTs plus two package EXECUTEs; direct table/history DML and table reads are denied.'
    Write-Output "I03_EVIDENCE $($evidence -replace '\s+',' ')"
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
