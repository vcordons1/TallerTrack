[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$flyway = Join-Path $repo 'database\scripts\invoke-flyway.ps1'
$bootstrap = Join-Path $repo 'database\scripts\bootstrap-tt-owner.ps1'
$migrations = Join-Path $repo 'database\migrations'
$sqlplus = (Get-Command sqlplus -ErrorAction Stop).Source

function Invoke-SysSql([string]$Sql) {
    $script = @"
whenever sqlerror exit sql.sqlcode
set echo off verify off feedback off heading off pagesize 0 linesize 500 trimspool on serveroutput on
alter session set container = XEPDB1;
$Sql
exit
"@
    $output = $script | & $sqlplus -s / as sysdba 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "Oracle SYS operation failed: $output" }
    return $output.Trim()
}

function Invoke-Flyway([string]$Command, [bool]$ShouldSucceed = $true) {
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $flyway $Command 2>&1 | Out-String
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $oldPreference }
    if ($ShouldSucceed -and $code -ne 0) { throw "Flyway $Command failed: $output" }
    if (-not $ShouldSucceed -and $code -eq 0) { throw "Flyway $Command unexpectedly succeeded: $output" }
    return $output
}

function Expect-OracleFailure([string]$Label, [string]$Schema, [string]$Sql, [string]$Code) {
    try {
        Invoke-SysSql "alter session set current_schema=$Schema;`n$Sql" | Out-Null
        throw "Expected $Label to fail with ORA-$Code."
    } catch {
        if ($_.Exception.Message -notmatch "ORA-$Code") {
            throw "Expected $Label -> ORA-$Code; actual: $($_.Exception.Message)"
        }
    }
    Write-Output "PASS negative: $Label -> ORA-$Code"
}

function New-TestOwner([string]$Schema, [string]$Password) {
    $secure = [Security.SecureString]::new()
    foreach ($character in $Password.ToCharArray()) { $secure.AppendChar($character) }
    $secure.MakeReadOnly()
    $output = & $bootstrap -SchemaName $Schema -OwnerPassword $secure 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "Bootstrap failed: $output" }
    if ($output.Contains($Password)) { throw 'Bootstrap output exposed the generated password.' }
    $evidence = Invoke-SysSql @"
select 'PRIVILEGES=' || listagg(privilege, ',') within group (order by privilege)
from dba_sys_privs where grantee='$Schema';
select 'QUOTA=' || max_bytes from dba_ts_quotas
where username='$Schema' and tablespace_name='USERS';
"@
    if ($evidence -notmatch 'PRIVILEGES=CREATE PROCEDURE,CREATE SEQUENCE,CREATE SESSION,CREATE TABLE,CREATE VIEW' -or $evidence -notmatch 'QUOTA=20971520') {
        throw "Owner is not least-privileged: $evidence"
    }
}

function Set-OwnerEnvironment([string]$Schema, [string]$Password) {
    $env:TT_DB_URL = 'jdbc:oracle:thin:@//127.0.0.1:1521/XEPDB1'
    $env:TT_DB_USER = $Schema
    $env:TT_DB_PASSWORD = $Password
}

function Assert-I01Structure([string]$Schema) {
    Invoke-SysSql @"
alter session set current_schema=$Schema;
declare
  c number;
  procedure eq(n varchar2, a number, e number) is
  begin if a <> e then raise_application_error(-20020,n||': expected '||e||', got '||a); end if; end;
begin
  select count(*) into c from all_tables where owner='$Schema' and table_name in
   ('ROL','CLIENTE','USUARIO','USUARIO_ROL','SESION','TOKEN_ACCESO','COMANDO','AUDITORIA_EVENTO','CONFIG_TALLER'); eq('tables',c,9);
  select count(*) into c from all_tables where owner='$Schema' and table_name='AUDITORIA'; eq('noncanonical table',c,0);
  select count(*) into c from all_constraints where owner='$Schema' and table_name in
   ('ROL','CLIENTE','USUARIO','USUARIO_ROL','SESION','TOKEN_ACCESO','COMANDO','AUDITORIA_EVENTO','CONFIG_TALLER') and status<>'ENABLED'; eq('disabled constraints',c,0);
  select count(*) into c from all_constraints where owner='$Schema' and constraint_name in
   ('FK_USUARIO_CLIENTE','FK_TOKEN_SESION_USUARIO','FK_COMANDO_SESION_ACTOR','UQ_COMANDO_INTENCION','CK_USUARIO_VARIANTE','CK_TOKEN_VARIANTE') and status='ENABLED'; eq('critical constraints',c,6);
  select count(*) into c from all_indexes where owner='$Schema' and index_name in
   ('UQ_USUARIO_ROL_VIGENTE','UQ_TOKEN_RENOVACION_ACTIVA') and uniqueness='UNIQUE' and status='VALID'; eq('conditional indexes',c,2);
  select count(*) into c from all_tab_columns where owner='$Schema' and table_name='USUARIO' and column_name='ID_USUARIO'
   and data_type='NUMBER' and data_precision=18 and data_scale=0 and nullable='N' and identity_column='YES'; eq('identity ID',c,1);
  select count(*) into c from all_tab_columns where owner='$Schema' and table_name='USUARIO' and column_name='LOGIN_NORMALIZADO'
   and data_type='VARCHAR2' and char_length=150 and char_used='C' and nullable='N'; eq('CHAR text',c,1);
  select count(*) into c from all_tab_columns where owner='$Schema' and table_name='TOKEN_ACCESO' and column_name='TOKEN_HASH'
   and data_type='RAW' and data_length=32 and nullable='N'; eq('RAW hash',c,1);
  select count(*) into c from all_tab_columns where owner='$Schema' and table_name='SESION' and column_name='CREADA_EN'
   and data_type='TIMESTAMP(6) WITH TIME ZONE' and data_scale=6 and nullable='N'; eq('timestamp',c,1);
  select count(*) into c from all_tab_columns where owner='$Schema' and table_name='CLIENTE' and column_name='ACTIVO'
   and data_type='NUMBER' and data_precision=1 and data_scale=0 and nullable='N'; eq('boolean',c,1);
  select count(*) into c from rol; eq('role count',c,5);
  select count(*) into c from rol where codigo_rol in ('ADMINISTRADOR','RECEPCIONISTA','MECANICO','INVENTARIO','CLIENTE'); eq('role values',c,5);
  select count(*) into c from config_taller where id_config=1 and moneda='GTQ' and zona_horaria='America/Guatemala'; eq('configuration values',c,1);
  select count(*) into c from config_taller; eq('configuration count',c,1);
  dbms_output.put_line('ASSERTIONS_OK');
end;
/
"@ | Out-Null
}

$saved = @{}
foreach ($name in 'TT_DB_URL','TT_DB_USER','TT_DB_PASSWORD','FLYWAY_LOCATIONS') {
    $saved[$name] = [Environment]::GetEnvironmentVariable($name,'Process')
}
$cleanSchema = 'TT_TEST_' + [guid]::NewGuid().ToString('N').Substring(0,12).ToUpperInvariant()
$upgradeSchema = 'TT_TEST_' + [guid]::NewGuid().ToString('N').Substring(0,12).ToUpperInvariant()
$cleanPassword = 'Aa9#' + [guid]::NewGuid().ToString('N').Substring(0,20)
$upgradePassword = 'Aa9#' + [guid]::NewGuid().ToString('N').Substring(0,20)
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('tallertrack-db-' + [guid]::NewGuid().ToString('N'))
$throughV017 = Join-Path $tempRoot 'through-v017'
$mutated = Join-Path $tempRoot 'mutated'
$created = [Collections.Generic.List[string]]::new()

try {
    foreach ($name in 'TT_DB_URL','TT_DB_USER','TT_DB_PASSWORD') { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
    $missing = Invoke-Flyway 'info' $false
    if ($missing -notmatch 'TT_DB_URL') { throw 'Missing configuration did not identify TT_DB_URL.' }
    Write-Output 'PASS configuration: missing settings fail clearly.'

    New-Item -ItemType Directory -Path $throughV017,$mutated | Out-Null
    Get-ChildItem -LiteralPath $migrations -Filter '*.sql' |
        Where-Object { $_.Name -match '^V0(0[1-9]|1[0-7])__' } |
        Copy-Item -Destination $throughV017
    Copy-Item (Join-Path $migrations '*.sql') $mutated

    New-TestOwner $cleanSchema $cleanPassword; $created.Add($cleanSchema)
    Set-OwnerEnvironment $cleanSchema $cleanPassword
    Remove-Item Env:FLYWAY_LOCATIONS -ErrorAction SilentlyContinue
    $badPassword = $cleanPassword + 'Z'; $env:TT_DB_PASSWORD = $badPassword
    $authenticationFailure = Invoke-Flyway 'info' $false
    if ($authenticationFailure.Contains($badPassword) -or $authenticationFailure.Contains($cleanPassword)) { throw 'Authentication output exposed a password.' }
    $env:TT_DB_PASSWORD = $cleanPassword
    $cleanMigrate = Invoke-Flyway 'migrate'; $cleanValidate = Invoke-Flyway 'validate'
    Assert-I01Structure $cleanSchema
    $cleanUserPackage = Invoke-SysSql @"
select 'USERS_VALID='||count(*) from dba_objects where owner='$cleanSchema' and object_name='PKG_USUARIOS_INTERNOS' and object_type in ('PACKAGE','PACKAGE BODY') and status='VALID';
select 'USERS_ERRORS='||count(*) from dba_errors where owner='$cleanSchema' and name='PKG_USUARIOS_INTERNOS';
"@
    if ($cleanUserPackage -notmatch 'USERS_VALID=2' -or $cleanUserPackage -notmatch 'USERS_ERRORS=0') {
        throw "Internal-user package failed clean-install compilation: $cleanUserPackage"
    }
    Write-Output 'PASS migration: clean schema applied V001 through V023.'

    New-TestOwner $upgradeSchema $upgradePassword; $created.Add($upgradeSchema)
    Set-OwnerEnvironment $upgradeSchema $upgradePassword
    $env:FLYWAY_LOCATIONS = 'filesystem:' + $throughV017.Replace('\','/')
    Invoke-Flyway 'migrate' | Out-Null
    $before = Invoke-SysSql "select 'COUNT='||count(*) from $upgradeSchema.`"flyway_schema_history`";"
    if ($before -notmatch 'COUNT=17') { throw "V017 upgrade base failed: $before" }
    Remove-Item Env:FLYWAY_LOCATIONS
    $upgrade = Invoke-Flyway 'migrate'; $second = Invoke-Flyway 'migrate'; $info = Invoke-Flyway 'info'; $validate = Invoke-Flyway 'validate'
    Assert-I01Structure $upgradeSchema
    $schemaEvidence = Invoke-SysSql @"
select 'TABLES='||count(*) from all_tables where owner='$upgradeSchema' and table_name in
 ('ROL','CLIENTE','USUARIO','USUARIO_ROL','SESION','TOKEN_ACCESO','COMANDO','AUDITORIA_EVENTO','CONFIG_TALLER');
select 'PK='||count(*) from all_constraints where owner='$upgradeSchema' and constraint_type='P' and table_name in
 ('ROL','CLIENTE','USUARIO','USUARIO_ROL','SESION','TOKEN_ACCESO','COMANDO','AUDITORIA_EVENTO','CONFIG_TALLER');
select 'FK='||count(*) from all_constraints where owner='$upgradeSchema' and constraint_type='R' and table_name in
 ('ROL','CLIENTE','USUARIO','USUARIO_ROL','SESION','TOKEN_ACCESO','COMANDO','AUDITORIA_EVENTO','CONFIG_TALLER');
select 'UQ='||count(*) from all_constraints where owner='$upgradeSchema' and constraint_type='U' and table_name in
 ('ROL','CLIENTE','USUARIO','USUARIO_ROL','SESION','TOKEN_ACCESO','COMANDO','AUDITORIA_EVENTO','CONFIG_TALLER');
select 'CHECK='||count(*) from all_constraints where owner='$upgradeSchema' and constraint_type='C' and generated='USER NAME' and table_name in
 ('ROL','CLIENTE','USUARIO','USUARIO_ROL','SESION','TOKEN_ACCESO','COMANDO','AUDITORIA_EVENTO','CONFIG_TALLER');
select 'CONDITIONAL_UQ='||count(*) from all_indexes where owner='$upgradeSchema'
 and index_name in ('UQ_USUARIO_ROL_VIGENTE','UQ_TOKEN_RENOVACION_ACTIVA') and uniqueness='UNIQUE';
"@
    $history = Invoke-SysSql @"
select 'MIGRATION_COUNT='||count(*) from $upgradeSchema."flyway_schema_history" where "version" in ('001','002','003','004','005','006','007','008','009','010','011','012','013','014','015','016','017','018','019','020','021','022','023') and "success"=1;
select 'DUPLICATES='||count(*) from (select "version" from $upgradeSchema."flyway_schema_history" group by "version" having count(*)>1);
select 'VERSIONS='||listagg("version",',') within group(order by "installed_rank") from $upgradeSchema."flyway_schema_history" where "success"=1;
select 'IDENTITY_VALID='||count(*) from dba_objects where owner='$upgradeSchema' and object_name in ('PKG_IDENTIDAD','PKG_IDENTIDAD_BOOTSTRAP') and object_type in ('PACKAGE','PACKAGE BODY') and status='VALID';
select 'IDENTITY_ERRORS='||count(*) from dba_errors where owner='$upgradeSchema' and name in ('PKG_IDENTIDAD','PKG_IDENTIDAD_BOOTSTRAP');
select 'RECEPTION_VALID='||count(*) from dba_objects where owner='$upgradeSchema' and object_name='PKG_RECEPCION_HTTP' and object_type in ('PACKAGE','PACKAGE BODY') and status='VALID';
select 'RECEPTION_ERRORS='||count(*) from dba_errors where owner='$upgradeSchema' and name='PKG_RECEPCION_HTTP';
select 'QUERY_VALID='||count(*) from dba_objects where owner='$upgradeSchema' and object_name in ('PKG_CONSULTAS_CLIENTES_VEHICULOS','PKG_CONSULTAS_ORDENES') and object_type in ('PACKAGE','PACKAGE BODY') and status='VALID';
select 'QUERY_ERRORS='||count(*) from dba_errors where owner='$upgradeSchema' and name in ('PKG_CONSULTAS_CLIENTES_VEHICULOS','PKG_CONSULTAS_ORDENES');
select 'DIAGNOSTIC_VALID='||count(*) from dba_objects where owner='$upgradeSchema' and object_name='PKG_DIAGNOSTICO_GRATUITO' and object_type in ('PACKAGE','PACKAGE BODY') and status='VALID';
select 'DIAGNOSTIC_ERRORS='||count(*) from dba_errors where owner='$upgradeSchema' and name='PKG_DIAGNOSTICO_GRATUITO';
select 'USERS_VALID='||count(*) from dba_objects where owner='$upgradeSchema' and object_name='PKG_USUARIOS_INTERNOS' and object_type in ('PACKAGE','PACKAGE BODY') and status='VALID';
select 'USERS_ERRORS='||count(*) from dba_errors where owner='$upgradeSchema' and name='PKG_USUARIOS_INTERNOS';
select 'CUSTOMER_VEHICLE_VALID='||count(*) from dba_objects where owner='$upgradeSchema' and object_name='PKG_CLIENTES_VEHICULOS_HTTP' and object_type in ('PACKAGE','PACKAGE BODY') and status='VALID';
select 'CUSTOMER_VEHICLE_ERRORS='||count(*) from dba_errors where owner='$upgradeSchema' and name='PKG_CLIENTES_VEHICULOS_HTTP';
"@
    if ($history -notmatch 'USERS_VALID=2' -or $history -notmatch 'USERS_ERRORS=0') {
        throw "Internal-user package failed upgrade compilation: $history"
    }
    if ($history -notmatch 'MIGRATION_COUNT=23' -or $history -notmatch 'DUPLICATES=0' -or $history -notmatch 'VERSIONS=001,002,003,004,005,006,007,008,009,010,011,012,013,014,015,016,017,018,019,020,021,022,023' -or $history -notmatch 'IDENTITY_VALID=4' -or $history -notmatch 'IDENTITY_ERRORS=0' -or $history -notmatch 'RECEPTION_VALID=2' -or $history -notmatch 'RECEPTION_ERRORS=0' -or $history -notmatch 'QUERY_VALID=4' -or $history -notmatch 'QUERY_ERRORS=0' -or $history -notmatch 'DIAGNOSTIC_VALID=2' -or $history -notmatch 'DIAGNOSTIC_ERRORS=0' -or $history -notmatch 'CUSTOMER_VEHICLE_VALID=2' -or $history -notmatch 'CUSTOMER_VEHICLE_ERRORS=0') { throw "Unexpected history: $history" }
    if ($info -notmatch 'Success' -or $validate -notmatch 'Successfully validated 23 migrations') { throw 'Flyway info/validate was not green for twenty-three migrations.' }

    Add-Content (Join-Path $mutated 'V001__technical_baseline.sql') '-- intentional checksum mutation'
    $env:FLYWAY_LOCATIONS = 'filesystem:' + $mutated.Replace('\','/')
    $checksumFailure = Invoke-Flyway 'validate' $false
    if ($checksumFailure -notmatch 'checksum|CHECKSUM_MISMATCH') { throw 'Mutated V001 was rejected for an unexpected reason.' }
    Remove-Item Env:FLYWAY_LOCATIONS

    Invoke-SysSql @"
alter session set current_schema=$upgradeSchema;
insert into usuario(id_usuario,tipo_actor,login_normalizado,nombre_mostrado,credencial_hash,version_credencial,activo,creado_en,actualizado_en,version_fila)
 values(100,'INTERNO','interno.prueba','Interno de prueba','TEST_ONLY_OPAQUE_CREDENTIAL_NOT_USED_FOR_AUTH',1,1,systimestamp,systimestamp,1);
insert into cliente(id_cliente,nombre,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
 values(200,'Cliente de prueba',1,systimestamp,100,systimestamp,100,1);
insert into cliente(id_cliente,nombre,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
 values(201,'Cliente sin cuenta de prueba',1,systimestamp,100,systimestamp,100,1);
insert into usuario(id_usuario,tipo_actor,id_cliente,login_normalizado,nombre_mostrado,credencial_hash,version_credencial,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
 values(101,'CLIENTE',200,'cliente.prueba','Cliente con cuenta de prueba','TEST_ONLY_OPAQUE_CREDENTIAL_NOT_USED_FOR_AUTH',1,1,systimestamp,100,systimestamp,100,1);
insert into usuario_rol(id_usuario_rol,id_usuario,codigo_rol,asignado_en,asignado_por) values(250,100,'ADMINISTRADOR',systimestamp,100);
insert into usuario_rol(id_usuario_rol,id_usuario,codigo_rol,asignado_en,asignado_por,retirado_en,retirado_por,motivo_retiro)
 values(249,100,'ADMINISTRADOR',systimestamp-interval '2' hour,100,systimestamp-interval '1' hour,100,'Asignacion historica de prueba');
insert into sesion(id_sesion,id_usuario,identificador_publico,creada_en,expira_en,version_credencial)
 values(300,101,hextoraw('00112233445566778899AABBCCDDEEFF'),systimestamp,systimestamp+interval '1' hour,1);
insert into sesion(id_sesion,id_usuario,identificador_publico,creada_en,expira_en,version_credencial)
 values(303,101,hextoraw('30112233445566778899AABBCCDDEEFF'),systimestamp,systimestamp+interval '1' hour,1);
insert into token_acceso(id_token,tipo,id_usuario,id_sesion,token_hash,emitido_en,expira_en)
 values(400,'RENOVACION',101,300,standard_hash('token-400','SHA256'),systimestamp,systimestamp+interval '1' hour);
insert into comando(id_comando,ambito,clave_idempotencia,solicitud_hash,tipo_operacion,id_actor,id_sesion,registrado_en,resultado_codigo,resultado_minimo)
 values(500,'actor:101/I01','clave-1',standard_hash('request-500','SHA256'),'PRUEBA',101,300,systimestamp,201,'{"id":"500"}');
insert into comando(id_comando,ambito,clave_idempotencia,solicitud_hash,tipo_operacion,id_actor,id_sesion,registrado_en,resultado_codigo)
 values(501,'actor:101/I01','clave-2',standard_hash('request-501','SHA256'),'PRUEBA',101,300,systimestamp,201);
insert into comando(id_comando,ambito,clave_idempotencia,solicitud_hash,tipo_operacion,id_actor,id_sesion,registrado_en,resultado_codigo)
 values(502,'actor:101/I02','clave-1',standard_hash('request-502','SHA256'),'PRUEBA',101,300,systimestamp,200);
insert into auditoria_evento(id_auditoria,id_actor,id_sesion,id_comando,ocurrido_en,accion,tipo_recurso,identificador_recurso,motivo,cambios,correlacion)
 values(600,101,300,500,systimestamp,'PRUEBA','COMANDO','500','Prueba estructural','{"estado":"ok"}','corr-600');
commit;
"@ | Out-Null

    $cases = @(
      @('duplicate role',"insert into rol values('ADMINISTRADOR','Otro')",'00001'),
      @('custom role',"insert into rol values('PERSONALIZADO','Personalizado')",'02290'),
      @('second config',"insert into config_taller(id_config,nombre,moneda,zona_horaria,creado_en,actualizado_en,version_fila) values(2,'X','GTQ','America/Guatemala',systimestamp,systimestamp,1)",'02290'),
      @('non-GTQ config',"update config_taller set moneda='USD' where id_config=1",'02290'),
      @('invalid timezone',"update config_taller set zona_horaria='UTC' where id_config=1",'02290'),
      @('CLIENTE without client',"insert into usuario(id_usuario,tipo_actor,login_normalizado,nombre_mostrado,credencial_hash,version_credencial,activo,creado_en,actualizado_en,version_fila) values(110,'CLIENTE','bad.client','Bad','TEST_ONLY',1,1,systimestamp,systimestamp,1)",'02290'),
      @('INTERNO with client',"insert into usuario(id_usuario,tipo_actor,id_cliente,login_normalizado,nombre_mostrado,credencial_hash,version_credencial,activo,creado_en,actualizado_en,version_fila) values(111,'INTERNO',201,'bad.internal','Bad','TEST_ONLY',1,1,systimestamp,systimestamp,1)",'02290'),
      @('duplicate login',"insert into usuario(id_usuario,tipo_actor,login_normalizado,nombre_mostrado,credencial_hash,version_credencial,activo,creado_en,actualizado_en,version_fila) values(112,'INTERNO','interno.prueba','Bad','TEST_ONLY',1,1,systimestamp,systimestamp,1)",'00001'),
      @('duplicate client account',"insert into usuario(id_usuario,tipo_actor,id_cliente,login_normalizado,nombre_mostrado,credencial_hash,version_credencial,activo,creado_en,actualizado_en,version_fila) values(113,'CLIENTE',200,'other.client','Bad','TEST_ONLY',1,1,systimestamp,systimestamp,1)",'00001'),
      @('missing client FK',"insert into usuario(id_usuario,tipo_actor,id_cliente,login_normalizado,nombre_mostrado,credencial_hash,version_credencial,activo,creado_en,actualizado_en,version_fila) values(114,'CLIENTE',999999,'ghost.client','Bad','TEST_ONLY',1,1,systimestamp,systimestamp,1)",'02291'),
      @('duplicate active role',"insert into usuario_rol(id_usuario_rol,id_usuario,codigo_rol,asignado_en,asignado_por) values(251,100,'ADMINISTRADOR',systimestamp,100)",'00001'),
      @('missing role FK',"insert into usuario_rol(id_usuario_rol,id_usuario,codigo_rol,asignado_en,asignado_por) values(252,100,'NO_EXISTE',systimestamp,100)",'02291'),
      @('missing user-role FK',"insert into usuario_rol(id_usuario_rol,id_usuario,codigo_rol,asignado_en,asignado_por) values(253,999999,'MECANICO',systimestamp,100)",'02291'),
      @('invalid session expiry',"insert into sesion(id_sesion,id_usuario,identificador_publico,creada_en,expira_en,version_credencial) values(301,101,hextoraw('10112233445566778899AABBCCDDEEFF'),systimestamp,systimestamp,1)",'02290'),
      @('revocation without reason',"update sesion set revocada_en=systimestamp where id_sesion=300",'02290'),
      @('missing session user',"insert into sesion(id_sesion,id_usuario,identificador_publico,creada_en,expira_en,version_credencial) values(302,999999,hextoraw('20112233445566778899AABBCCDDEEFF'),systimestamp,systimestamp+interval '1' hour,1)",'02291'),
      @('invalid token expiry',"insert into token_acceso(id_token,tipo,id_usuario,token_hash,emitido_en,expira_en) values(401,'RECUPERACION',101,standard_hash('token-401','SHA256'),systimestamp,systimestamp)",'02290'),
      @('impossible token variant',"insert into token_acceso(id_token,tipo,id_usuario,token_hash,emitido_en,expira_en) values(402,'RENOVACION',101,standard_hash('token-402','SHA256'),systimestamp,systimestamp+interval '1' hour)",'02290'),
      @('token session-user mismatch',"insert into token_acceso(id_token,tipo,id_usuario,id_sesion,token_hash,emitido_en,expira_en) values(403,'RENOVACION',100,303,standard_hash('token-403','SHA256'),systimestamp,systimestamp+interval '1' hour)",'02291'),
      @('duplicate token hash',"insert into token_acceso(id_token,tipo,id_usuario,token_hash,emitido_en,expira_en) values(404,'RECUPERACION',101,standard_hash('token-400','SHA256'),systimestamp,systimestamp+interval '1' hour)",'00001'),
      @('second active renewal',"insert into token_acceso(id_token,tipo,id_usuario,id_sesion,token_hash,emitido_en,expira_en) values(405,'RENOVACION',101,300,standard_hash('token-405','SHA256'),systimestamp,systimestamp+interval '1' hour)",'00001'),
      @('duplicate command intent',"insert into comando(id_comando,ambito,clave_idempotencia,solicitud_hash,tipo_operacion,registrado_en,resultado_codigo) values(503,'actor:101/I01','clave-1',standard_hash('r503','SHA256'),'PRUEBA',systimestamp,201)",'00001'),
      @('command actor-session mismatch',"insert into comando(id_comando,ambito,clave_idempotencia,solicitud_hash,tipo_operacion,id_actor,id_sesion,registrado_en,resultado_codigo) values(504,'actor:100/I01','clave-3',standard_hash('r504','SHA256'),'PRUEBA',100,303,systimestamp,201)",'02291'),
      @('invalid command JSON',"insert into comando(id_comando,ambito,clave_idempotencia,solicitud_hash,tipo_operacion,registrado_en,resultado_codigo,resultado_minimo) values(505,'public/I01','clave-4',standard_hash('r505','SHA256'),'PRUEBA',systimestamp,201,'not-json')",'02290'),
      @('invalid audit JSON',"insert into auditoria_evento(id_auditoria,ocurrido_en,accion,tipo_recurso,identificador_recurso,motivo,cambios,correlacion) values(601,systimestamp,'PRUEBA','COMANDO','x','Prueba','not-json','corr-601')",'02290')
    )
    foreach ($case in $cases) { Expect-OracleFailure $case[0] $upgradeSchema ($case[1] + ';') $case[2] }

    $allOutput = $authenticationFailure+$cleanMigrate+$cleanValidate+$upgrade+$second+$info+$validate+$history+$checksumFailure
    foreach ($password in $cleanPassword,$upgradePassword) { if ($allOutput.Contains($password)) { throw 'Test output exposed a generated password.' } }
    Write-Output 'PASS bootstrap: only required object-creation privileges and a 20 MiB quota.'
    Write-Output 'PASS upgrade/idempotency: V017 upgraded through V023; second migrate duplicated neither history nor seeds.'
    Write-Output 'PASS structure/seeds: nine I01 tables, critical types, enabled constraints, conditional indexes, five roles, and singleton configuration.'
    Write-Output 'PASS validation: Flyway validated V001-V023, identity/reception/query/diagnostic/user/customer-vehicle packages are VALID without USER_ERRORS, and a changed applied V001 was rejected.'
    Write-Output "ORACLE_EVIDENCE $($history -replace '\s+',' ')"
    Write-Output "SCHEMA_EVIDENCE $($schemaEvidence -replace '\s+',' ')"
}
finally {
    foreach ($schema in $created) {
        if ($schema -notmatch '^TT_TEST_[A-F0-9]{12}$') { throw "Refusing to drop $schema." }
        Invoke-SysSql "drop user $schema cascade;" | Out-Null
    }
    if (Test-Path $tempRoot) {
        $resolved = (Resolve-Path $tempRoot).Path
        $systemTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
        if (-not $resolved.StartsWith($systemTemp+'\',[StringComparison]::OrdinalIgnoreCase)) { throw "Refusing to remove $resolved." }
        Remove-Item $resolved -Recurse -Force
    }
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name,$saved[$name],'Process') }
}
