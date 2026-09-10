[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$flyway = Join-Path $repo 'database\scripts\invoke-flyway.ps1'
$ownerBootstrap = Join-Path $repo 'database\scripts\bootstrap-tt-owner.ps1'
$appBootstrap = Join-Path $repo 'database\scripts\bootstrap-tt-app.ps1'
$sqlplus = (Get-Command sqlplus -ErrorAction Stop).Source
$suffix = [guid]::NewGuid().ToString('N').Substring(0,12).ToUpperInvariant()
$schema = "TT_TEST_$suffix"
$runtime = "TT_TEST_APP_$suffix"
$ownerPassword = "Ow1!$suffix"
$runtimePassword = "Ap1!$suffix"
$ownerCreated = $false
$runtimeCreated = $false
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

$hT24Request = Get-TestRawSql 't24-ok'
$hT24Qr = Get-TestRawSql 'qr-t24'
$hBadQrRequest = Get-TestRawSql 'bad-qr'
$hBadPropertyRequest = Get-TestRawSql 'bad-prop'
$hBadPropertyQr = Get-TestRawSql 'qr-bad-prop'
$hNull1Request = Get-TestRawSql 'null-1'
$hNull1Qr = Get-TestRawSql 'qr-null-1'
$hNull2Request = Get-TestRawSql 'null-2'
$hNull2Qr = Get-TestRawSql 'qr-null-2'
$hT10Request = Get-TestRawSql 't10-ok'
$hT10Qr = Get-TestRawSql 'qr-t10'
$hSameRequest = Get-TestRawSql 'same'
$hSameQr = Get-TestRawSql 'qr-same'
$hStaleRequest = Get-TestRawSql 'stale'
$hStaleQr = Get-TestRawSql 'qr-stale'
$hBadT10Request = Get-TestRawSql 'bad-t10'
$hT11Request = Get-TestRawSql 't11-ok'
$hT11Qr = Get-TestRawSql 'qr-t11'
$hOldRequest = Get-TestRawSql 't11-old'
$hOldQr = Get-TestRawSql 'qr-t11-old'
$hRaceTaRequest = Get-TestRawSql 'race-ta'
$hRaceTaQr = Get-TestRawSql 'race-ta-qr'
$hRaceTbRequest = Get-TestRawSql 'race-tb'
$hRaceTbQr = Get-TestRawSql 'race-tb-qr'
$hRaceQaRequest = Get-TestRawSql 'race-qa'
$hRaceQaToken = Get-TestRawSql 'race-qa-token'
$hRaceQbRequest = Get-TestRawSql 'race-qb'
$hRaceQbToken = Get-TestRawSql 'race-qb-token'

function Invoke-SysSql([string]$Sql) {
    $script = @"
whenever sqlerror exit sql.sqlcode
set echo off verify off feedback off heading off pagesize 0 linesize 1000 trimspool on serveroutput on
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
set echo off verify off feedback off heading off pagesize 0 linesize 1000 trimspool on serveroutput on
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

function Get-CurrentIds([string]$Plate) {
    $output = Invoke-OwnerSql @"
select 'IDS=' || v.id_vehiculo || ':' || p.id_propiedad || ':' || q.id_qr
from vehiculo v
join propiedad_vehiculo p on p.id_vehiculo=v.id_vehiculo and p.hasta_en is null
join qr_token q on q.id_vehiculo=v.id_vehiculo and q.revocado_en is null
where v.placa='$Plate';
"@
    if ($output -notmatch 'IDS=(\d+):(\d+):(\d+)') { throw "Could not resolve IDs for ${Plate}: $output" }
    return @([long]$Matches[1], [long]$Matches[2], [long]$Matches[3])
}

try {
    $ownerSecure = ConvertTo-TestSecureString $ownerPassword
    $bootstrapOutput = & $ownerBootstrap -SchemaName $schema -OwnerPassword $ownerSecure 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "Owner bootstrap failed: $bootstrapOutput" }
    $ownerCreated = $true

    $env:TT_DB_URL = 'jdbc:oracle:thin:@//127.0.0.1:1521/XEPDB1'
    $env:TT_DB_USER = $schema
    $env:TT_DB_PASSWORD = $ownerPassword
    Remove-Item Env:FLYWAY_LOCATIONS -ErrorAction SilentlyContinue
    $migrate = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $flyway migrate 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "Flyway migrate failed: $migrate" }
    $second = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $flyway migrate 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "Second Flyway migrate failed: $second" }
    $validate = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $flyway validate 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0 -or $validate -notmatch 'Successfully validated 11 migrations') { throw "Flyway validate failed: $validate" }

    $structure = Invoke-SysSql @"
alter session set current_schema=$schema;
declare
  c number;
  procedure eq(n varchar2, a number, e number) is
  begin if a <> e then raise_application_error(-20090,n||': expected '||e||', got '||a); end if; end;
begin
  select count(*) into c from all_tables where owner='$schema' and table_name in
    ('TIPO_VEHICULO','VEHICULO','PROPIEDAD_VEHICULO','QR_TOKEN'); eq('I02 tables',c,4);
  select count(*) into c from all_tab_columns where owner='$schema' and table_name='VEHICULO' and column_name='ID_CLIENTE'; eq('direct owner column',c,0);
  select count(*) into c from all_constraints where owner='$schema' and table_name in
    ('TIPO_VEHICULO','VEHICULO','PROPIEDAD_VEHICULO','QR_TOKEN') and status<>'ENABLED'; eq('disabled constraints',c,0);
  select count(*) into c from all_constraints where owner='$schema' and constraint_name in
    ('UQ_VEHICULO_PLACA','UQ_VEHICULO_VIN','UQ_PROP_PREDECESORA','UQ_PROP_CONTEXTO','FK_PROPIEDAD_PREDECESORA','CK_QR_REVOCACION') and status='ENABLED'; eq('critical constraints',c,6);
  select count(*) into c from all_indexes where owner='$schema' and index_name in
    ('UQ_PROPIEDAD_ACTUAL','UQ_QR_NO_REVOCADO') and uniqueness='UNIQUE' and status='VALID'; eq('conditional indexes',c,2);
  select count(*) into c from all_objects where owner='$schema' and object_name='PKG_VEHICULOS' and object_type in ('PACKAGE','PACKAGE BODY') and status='VALID'; eq('package objects',c,2);
  select count(*) into c from all_views where owner='$schema' and view_name='V_PROPIETARIO_ACTUAL'; eq('owner view',c,1);
  select count(*) into c from all_tab_columns where owner='$schema' and table_name='QR_TOKEN' and column_name='TOKEN_HASH' and data_type='RAW' and data_length=32 and nullable='N'; eq('QR hash type',c,1);
  select count(*) into c from all_tab_columns where owner='$schema' and table_name='VEHICULO' and column_name='ANIO' and data_precision=4 and data_scale=0 and nullable='Y'; eq('year type',c,1);
  select count(*) into c from tipo_vehiculo; eq('vehicle type count',c,5);
  select count(*) into c from tipo_vehiculo where codigo_tipo in ('AUTOMOVIL','MOTOCICLETA','CAMIONETA','CAMION','OTRO') and activo=1; eq('vehicle type values',c,5);
  dbms_output.put_line('STRUCTURE_OK');
end;
/
"@
    if ($null -eq $structure) { throw 'I02 structural verification returned no execution result.' }

    Invoke-OwnerSql @"
insert into usuario(id_usuario,tipo_actor,login_normalizado,nombre_mostrado,credencial_hash,version_credencial,activo,creado_en,actualizado_en,version_fila)
 values(100,'INTERNO','i02.actor.a','Actor A','TEST_ONLY',1,1,systimestamp,systimestamp,1);
insert into usuario(id_usuario,tipo_actor,login_normalizado,nombre_mostrado,credencial_hash,version_credencial,activo,creado_en,actualizado_en,version_fila)
 values(101,'INTERNO','i02.actor.b','Actor B','TEST_ONLY',1,1,systimestamp,systimestamp,1);
insert into cliente(id_cliente,nombre,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
 values(200,'Cliente A',1,systimestamp,100,systimestamp,100,1);
insert into cliente(id_cliente,nombre,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
 values(201,'Cliente B',1,systimestamp,100,systimestamp,100,1);
insert into cliente(id_cliente,nombre,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
 values(202,'Cliente C',1,systimestamp,100,systimestamp,100,1);
insert into comando(id_comando,ambito,clave_idempotencia,solicitud_hash,tipo_operacion,id_actor,registrado_en,resultado_codigo)
 values(9000,'fixture/I02','fixture',standard_hash('fixture','SHA256'),'PRUEBA_I02',100,systimestamp,200);
commit;
"@ | Out-Null

    $appSecure = ConvertTo-TestSecureString $runtimePassword
    $appOutput = & $appBootstrap -RuntimeUser $runtime -OwnerSchema $schema -RuntimePassword $appSecure 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "Runtime bootstrap failed: $appOutput" }
    $runtimeCreated = $true

    $runtimeGrants = Invoke-SysSql @"
select 'SYS='||listagg(privilege,',') within group(order by privilege) from dba_sys_privs where grantee='$runtime';
select 'SELECTS='||count(*) from dba_tab_privs where grantee='$runtime' and owner='$schema' and privilege='SELECT';
select 'EXECUTES='||count(*) from dba_tab_privs where grantee='$runtime' and owner='$schema' and privilege='EXECUTE' and table_name in ('PKG_VEHICULOS','PKG_AGENDA');
select 'DML='||count(*) from dba_tab_privs where grantee='$runtime' and owner='$schema' and privilege in ('INSERT','UPDATE','DELETE');
select 'QUOTA='||count(*) from dba_ts_quotas where username='$runtime' and max_bytes<>0;
"@
    Assert-Output 'runtime system privilege' $runtimeGrants 'SYS=CREATE SESSION'
    Assert-Output 'runtime SELECT grants' $runtimeGrants 'SELECTS=3'
    Assert-Output 'runtime package grant' $runtimeGrants 'EXECUTES=2'
    Assert-Output 'runtime direct DML' $runtimeGrants 'DML=0'
    Assert-Output 'runtime quota' $runtimeGrants 'QUOTA=0'
    Assert-Output 'runtime DDL denial' (Invoke-RuntimeSql 'create table forbidden_i02(id number);' $false) 'ORA-01031'
    Assert-Output 'runtime DML denial' (Invoke-RuntimeSql "delete from $schema.vehiculo;" $false) 'ORA-00942|ORA-01031'
    Assert-Output 'runtime hash denial' (Invoke-RuntimeSql "select token_hash from $schema.qr_token;" $false) 'ORA-00942|ORA-01031'

    $register = Invoke-RuntimeSql @"
declare v number; p number; q number; r number;
begin
  $schema.pkg_vehiculos.registrar_vehiculo(
    'actor:100/I02','t24-ok',$hT24Request,100,null,'corr-t24',200,
    'AUTOMOVIL','P-100','VIN-100','Marca','Modelo',2024,'Azul','Alta inicial',
    $hT24Qr,null,v,p,q,r);
  dbms_output.put_line('REGISTER='||v||':'||p||':'||q||':'||r);
  commit;
end;
/
"@
    Assert-Output 'T24 success through runtime package' $register 'REGISTER=\d+:\d+:\d+:0'
    $mainIds = Get-CurrentIds 'P-100'
    $mainVehicle = $mainIds[0]; $mainProperty = $mainIds[1]; $mainQr = $mainIds[2]

    $replay = Invoke-RuntimeSql @"
declare v number; p number; q number; r number;
begin
  $schema.pkg_vehiculos.registrar_vehiculo(
    'actor:100/I02','t24-ok',$hT24Request,100,null,'corr-t24',200,
    'AUTOMOVIL','P-100','VIN-100','Marca','Modelo',2024,'Azul','Alta inicial',
    $hT24Qr,null,v,p,q,r);
  dbms_output.put_line('REPLAY='||v||':'||p||':'||q||':'||r);
  commit;
end;
/
"@
    Assert-Output 'T24 replay' $replay "REPLAY=$mainVehicle`:$mainProperty`:$mainQr`:1"
    $t24Count = Invoke-OwnerSql "select 'COUNTS='||(select count(*) from vehiculo where placa='P-100')||':'||(select count(*) from propiedad_vehiculo where id_vehiculo=$mainVehicle)||':'||(select count(*) from qr_token where id_vehiculo=$mainVehicle) from dual;"
    Assert-Output 'T24 replay did not duplicate business' $t24Count 'COUNTS=1:1:1'

    $rollbackQr = Invoke-OwnerSql @"
declare v number; p number; q number; r number;
begin
  begin
    pkg_vehiculos.registrar_vehiculo('actor:100/I02','t24-bad-qr',$hBadQrRequest,100,null,'corr-bad-qr',200,
      'AUTOMOVIL','P-BAD-QR','VIN-BAD-QR','Marca','Modelo',2024,null,'Alta invalida',null,null,v,p,q,r);
  exception when others then dbms_output.put_line('EXPECTED='||sqlcode); end;
  select count(*) into v from vehiculo where placa='P-BAD-QR';
  dbms_output.put_line('T24_QR_ROLLBACK='||v);
  rollback;
end;
/
"@
    Assert-Output 'T24 QR failure rollback' $rollbackQr 'T24_QR_ROLLBACK=0'

    Invoke-OwnerSql @"
declare v number; p number; q number; r number;
begin
  pkg_vehiculos.registrar_vehiculo('actor:100/I02','t24-caller-rollback',$(Get-TestRawSql 't24-caller-rollback'),100,null,'corr-caller-rollback',200,
    'AUTOMOVIL','P-ROLLBACK','VIN-ROLLBACK','Marca','Modelo',2024,null,'Rollback del llamador',$(Get-TestRawSql 'qr-caller-rollback'),null,v,p,q,r);
  rollback;
end;
/
"@ | Out-Null
    Assert-Output 'package leaves commit to caller' (Invoke-OwnerSql "select 'CALLER_ROLLBACK='||count(*) from vehiculo where placa='P-ROLLBACK';") 'CALLER_ROLLBACK=0'

    $rollbackProperty = Invoke-OwnerSql @"
declare v number; p number; q number; r number;
begin
  begin
    pkg_vehiculos.registrar_vehiculo('actor:100/I02','t24-bad-prop',$hBadPropertyRequest,100,null,'corr-bad-prop',200,
      'AUTOMOVIL','P-BAD-PROP','VIN-BAD-PROP','Marca','Modelo',2024,null,null,$hBadPropertyQr,null,v,p,q,r);
  exception when others then dbms_output.put_line('EXPECTED='||sqlcode); end;
  select count(*) into v from vehiculo where placa='P-BAD-PROP';
  dbms_output.put_line('T24_PROP_ROLLBACK='||v);
  rollback;
end;
/
"@
    Assert-Output 'T24 property failure rollback' $rollbackProperty 'T24_PROP_ROLLBACK=0'

    Expect-OracleFailure 'duplicate vehicle type code' "insert into tipo_vehiculo values('AUTOMOVIL','Otro nombre',1);" '00001'
    Expect-OracleFailure 'duplicate vehicle type name' "insert into tipo_vehiculo values('NUEVO','Automovil',1);" '00001'
    Expect-OracleFailure 'invalid vehicle type boolean' "insert into tipo_vehiculo values('NUEVO','Nuevo',2);" '02290'
    Expect-OracleFailure 'invalid vehicle type FK' "insert into vehiculo(codigo_tipo,marca,modelo,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila) values('NO_EXISTE','M','X',1,systimestamp,100,systimestamp,100,1);" '02291'
    Expect-OracleFailure 'duplicate plate' "insert into vehiculo(codigo_tipo,placa,marca,modelo,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila) values('AUTOMOVIL','P-100','M','X',1,systimestamp,100,systimestamp,100,1);" '00001'
    Expect-OracleFailure 'duplicate VIN' "insert into vehiculo(codigo_tipo,vin,marca,modelo,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila) values('AUTOMOVIL','VIN-100','M','X',1,systimestamp,100,systimestamp,100,1);" '00001'
    Expect-OracleFailure 'invalid year' "insert into vehiculo(codigo_tipo,marca,modelo,anio,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila) values('AUTOMOVIL','M','X',0,1,systimestamp,100,systimestamp,100,1);" '02290'
    Expect-OracleFailure 'invalid vehicle boolean' "insert into vehiculo(codigo_tipo,marca,modelo,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila) values('AUTOMOVIL','M','X',2,systimestamp,100,systimestamp,100,1);" '02290'

    Invoke-OwnerSql @"
declare v number; p number; q number; r number;
begin
  pkg_vehiculos.registrar_vehiculo('actor:100/I02','null-identifiers-1',$hNull1Request,100,null,'corr-null-1',200,
    'OTRO',null,null,'Marca','Sin identificador 1',null,null,'Alta sin identificadores',$hNull1Qr,null,v,p,q,r);
  pkg_vehiculos.registrar_vehiculo('actor:100/I02','null-identifiers-2',$hNull2Request,100,null,'corr-null-2',200,
    'OTRO',null,null,'Marca','Sin identificador 2',null,null,'Alta sin identificadores',$hNull2Qr,null,v,p,q,r);
  commit;
end;
/
"@ | Out-Null
    Assert-Output 'nullable identifiers' (Invoke-OwnerSql 'select ''NULL_IDS=''||count(*) from vehiculo where placa is null and vin is null;') 'NULL_IDS=2'

    Expect-OracleFailure 'missing property client' "insert into propiedad_vehiculo(id_vehiculo,id_cliente,desde_en,hasta_en,motivo,registrado_por,cerrado_por,id_comando) values($mainVehicle,999999,systimestamp-interval '2' hour,systimestamp-interval '1' hour,'X',100,100,9000);" '02291'
    Expect-OracleFailure 'missing property vehicle' "insert into propiedad_vehiculo(id_vehiculo,id_cliente,desde_en,motivo,registrado_por,id_comando) values(999999,200,systimestamp,'X',100,9000);" '02291'
    Expect-OracleFailure 'missing property actor' "insert into propiedad_vehiculo(id_vehiculo,id_cliente,desde_en,hasta_en,motivo,registrado_por,cerrado_por,id_comando) values($mainVehicle,200,systimestamp-interval '2' hour,systimestamp-interval '1' hour,'X',999999,100,9000);" '02291'
    Expect-OracleFailure 'invalid property interval' "insert into propiedad_vehiculo(id_vehiculo,id_cliente,desde_en,hasta_en,motivo,registrado_por,cerrado_por,id_comando) values($mainVehicle,200,systimestamp,systimestamp,'X',100,100,9000);" '02290'
    Expect-OracleFailure 'second open property' "insert into propiedad_vehiculo(id_vehiculo,id_cliente,desde_en,motivo,registrado_por,id_comando) values($mainVehicle,201,systimestamp,'X',100,9000);" '00001'
    Invoke-OwnerSql @"
insert into vehiculo(id_vehiculo,codigo_tipo,placa,marca,modelo,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
 values(7000,'AUTOMOVIL','CTX-7000','M','X',1,systimestamp,100,systimestamp,100,1);
insert into propiedad_vehiculo(id_propiedad,id_vehiculo,id_cliente,desde_en,hasta_en,motivo,registrado_por,cerrado_por,id_comando)
 values(7000,7000,200,systimestamp-interval '2' hour,systimestamp-interval '1' hour,'Context fixture',100,100,9000);
commit;
"@ | Out-Null
    Expect-OracleFailure 'invalid predecessor vehicle context' "insert into propiedad_vehiculo(id_vehiculo,id_cliente,desde_en,hasta_en,motivo,registrado_por,cerrado_por,id_predecesora,id_comando) values($mainVehicle,201,systimestamp-interval '30' minute,systimestamp-interval '15' minute,'X',100,100,7000,9000);" '02291'

    $transferred = Invoke-OwnerSql @"
declare pa number; pn number; q number; r number;
begin
  pkg_vehiculos.transferir_propiedad('actor:100/I02','t10-ok',$hT10Request,100,null,'corr-t10',$mainVehicle,$mainProperty,200,201,
    'Transferencia valida',$hT10Qr,null,pa,pn,q,r);
  dbms_output.put_line('TRANSFER='||pa||':'||pn||':'||q||':'||r);
  commit;
end;
/
"@
    Assert-Output 'T10 success' $transferred "TRANSFER=$mainProperty`:\d+:\d+:0"
    $afterTransfer = Get-CurrentIds 'P-100'
    $propertyAfterTransfer = $afterTransfer[1]; $qrAfterTransfer = $afterTransfer[2]
    $transferEvidence = Invoke-OwnerSql @"
select 'T10=' ||
 (select count(*) from propiedad_vehiculo where id_vehiculo=$mainVehicle) || ':' ||
 (select count(*) from propiedad_vehiculo where id_propiedad=$mainProperty and id_cliente=200 and hasta_en is not null) || ':' ||
 (select count(*) from propiedad_vehiculo n join propiedad_vehiculo a on a.id_propiedad=n.id_predecesora where n.id_propiedad=$propertyAfterTransfer and n.desde_en=a.hasta_en) || ':' ||
 (select count(*) from qr_token where id_qr=$mainQr and revocado_en is not null) || ':' ||
 (select count(*) from qr_token where id_vehiculo=$mainVehicle and revocado_en is null)
from dual;
"@
    Assert-Output 'T10 history and QR' $transferEvidence 'T10=2:1:1:1:1'

    $sameOwner = Invoke-OwnerSql @"
declare pa number; pn number; q number; r number;
begin
  begin pkg_vehiculos.transferir_propiedad('actor:100/I02','t10-same',$hSameRequest,100,null,'corr-same',$mainVehicle,$propertyAfterTransfer,201,201,
    'No permitido',$hSameQr,null,pa,pn,q,r);
  exception when others then dbms_output.put_line('SAME_OWNER='||sqlcode); end;
  rollback;
end;
/
"@
    Assert-Output 'T10 same owner rejection' $sameOwner 'SAME_OWNER=-20020'
    $wrongExpected = Invoke-OwnerSql @"
declare pa number; pn number; q number; r number;
begin
  begin pkg_vehiculos.transferir_propiedad('actor:100/I02','t10-stale',$hStaleRequest,100,null,'corr-stale',$mainVehicle,$mainProperty,200,202,
    'No permitido',$hStaleQr,null,pa,pn,q,r);
  exception when others then dbms_output.put_line('STALE_OWNER='||sqlcode); end;
  rollback;
end;
/
"@
    Assert-Output 'T10 stale property rejection' $wrongExpected 'STALE_OWNER=-20021'
    $transferRollback = Invoke-OwnerSql @"
declare pa number; pn number; q number; r number; c number; cq number;
begin
  begin pkg_vehiculos.transferir_propiedad('actor:100/I02','t10-bad-qr',$hBadT10Request,100,null,'corr-bad-t10',$mainVehicle,$propertyAfterTransfer,201,202,
    'Debe revertir',null,null,pa,pn,q,r);
  exception when others then dbms_output.put_line('EXPECTED='||sqlcode); end;
  select count(*) into c from propiedad_vehiculo where id_vehiculo=$mainVehicle and hasta_en is null and id_propiedad=$propertyAfterTransfer and id_cliente=201;
  select count(*) into cq from qr_token where id_vehiculo=$mainVehicle and id_qr=$qrAfterTransfer and revocado_en is null;
  dbms_output.put_line('T10_ROLLBACK='||c||':'||cq);
  rollback;
end;
/
"@
    Assert-Output 'T10 QR failure full rollback' $transferRollback 'T10_ROLLBACK=1:1'

    $rotated = Invoke-OwnerSql @"
declare q number; r number;
begin
  pkg_vehiculos.rotar_qr('actor:100/I02','t11-ok',$hT11Request,100,null,'corr-t11',$mainVehicle,$qrAfterTransfer,
    'Rotacion valida',$hT11Qr,null,q,r);
  dbms_output.put_line('ROTATE='||q||':'||r);
  commit;
end;
/
"@
    Assert-Output 'T11 success' $rotated 'ROTATE=\d+:0'
    $afterRotate = Get-CurrentIds 'P-100'; $qrAfterRotate = $afterRotate[2]
    $oldGeneration = Invoke-OwnerSql @"
declare q number; r number;
begin
  begin pkg_vehiculos.rotar_qr('actor:100/I02','t11-old',$hOldRequest,100,null,'corr-old',$mainVehicle,$qrAfterTransfer,
    'Generacion vieja',$hOldQr,null,q,r);
  exception when others then dbms_output.put_line('OLD_GENERATION='||sqlcode); end;
  rollback;
end;
/
"@
    Assert-Output 'T11 stale generation rejection' $oldGeneration 'OLD_GENERATION=-20031'

    Expect-OracleFailure 'duplicate QR hash' "insert into qr_token(id_vehiculo,token_hash,emitido_en,emitido_por,id_comando) values($mainVehicle,$hT11Qr,systimestamp,100,9000);" '00001'
    Expect-OracleFailure 'missing QR vehicle' "insert into qr_token(id_vehiculo,token_hash,emitido_en,emitido_por,id_comando) values(999999,standard_hash('qr-missing','SHA256'),systimestamp,100,9000);" '02291'
    Expect-OracleFailure 'invalid QR expiration' "insert into qr_token(id_vehiculo,token_hash,emitido_en,emitido_por,expira_en,revocado_en,revocado_por,motivo_revocacion,id_comando) values($mainVehicle,standard_hash('qr-exp','SHA256'),to_timestamp_tz('2026-01-01 10:00:00 +00:00','YYYY-MM-DD HH24:MI:SS TZH:TZM'),100,to_timestamp_tz('2026-01-01 10:00:00 +00:00','YYYY-MM-DD HH24:MI:SS TZH:TZM'),null,null,null,9000);" '02290'
    Expect-OracleFailure 'QR revocation before emission' "insert into qr_token(id_vehiculo,token_hash,emitido_en,emitido_por,revocado_en,revocado_por,motivo_revocacion,id_comando) values($mainVehicle,standard_hash('qr-rev-time','SHA256'),to_timestamp_tz('2026-01-01 10:00:00 +00:00','YYYY-MM-DD HH24:MI:SS TZH:TZM'),100,to_timestamp_tz('2026-01-01 09:59:59 +00:00','YYYY-MM-DD HH24:MI:SS TZH:TZM'),100,'X',9000);" '02290'
    Expect-OracleFailure 'incoherent QR revocation' "insert into qr_token(id_vehiculo,token_hash,emitido_en,emitido_por,revocado_en,id_comando) values($mainVehicle,standard_hash('qr-incoherent','SHA256'),systimestamp,100,systimestamp,9000);" '02290'
    Expect-OracleFailure 'second current QR' "insert into qr_token(id_vehiculo,token_hash,emitido_en,emitido_por,id_comando) values($mainVehicle,standard_hash('qr-second','SHA256'),systimestamp,100,9000);" '00001'
    Expect-OracleFailure 'duplicate predecessor' "insert into propiedad_vehiculo(id_vehiculo,id_cliente,desde_en,hasta_en,motivo,registrado_por,cerrado_por,id_predecesora,id_comando) values($mainVehicle,202,systimestamp-interval '2' hour,systimestamp-interval '1' hour,'X',100,100,$mainProperty,9000);" '00001'

    # Concurrent unique-owner protection with two independent Oracle sessions.
    Invoke-OwnerSql @"
insert into vehiculo(id_vehiculo,codigo_tipo,placa,marca,modelo,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
 values(8000,'AUTOMOVIL','RACE-PROP','M','X',1,systimestamp,100,systimestamp,100,1);
commit;
"@ | Out-Null
    $propA = Start-OracleJob @"
begin
  insert into propiedad_vehiculo(id_vehiculo,id_cliente,desde_en,motivo,registrado_por,id_comando) values(8000,200,systimestamp,'Race A',100,9000);
  dbms_session.sleep(3); commit; dbms_output.put_line('PROP_A=COMMIT');
exception when others then rollback; dbms_output.put_line('PROP_A='||sqlcode); end;
/
"@
    Start-Sleep -Milliseconds 700
    $propB = Start-OracleJob @"
begin
  insert into propiedad_vehiculo(id_vehiculo,id_cliente,desde_en,motivo,registrado_por,id_comando) values(8000,201,systimestamp,'Race B',101,9000);
  commit; dbms_output.put_line('PROP_B=COMMIT');
exception when others then rollback; dbms_output.put_line('PROP_B='||sqlcode); end;
/
"@
    $propRace = Wait-OracleJobs @($propA,$propB)
    Assert-Output 'property race winner' ($propRace -join "`n") 'PROP_A=COMMIT'
    Assert-Output 'property race loser' ($propRace -join "`n") 'PROP_B=-1'
    Assert-Output 'property race final state' (Invoke-OwnerSql "select 'OPEN_PROPERTIES='||count(*) from propiedad_vehiculo where id_vehiculo=8000 and hasta_en is null;") 'OPEN_PROPERTIES=1'

    # Concurrent transfer: same expected property, one winner after blocking.
    $transferA = Start-OracleJob @"
declare pa number; pn number; q number; r number;
begin pkg_vehiculos.transferir_propiedad('actor:100/I02','race-transfer-a',$hRaceTaRequest,100,null,'race-ta',$mainVehicle,$propertyAfterTransfer,201,202,
 'Race transfer A',$hRaceTaQr,null,pa,pn,q,r); dbms_session.sleep(3); commit; dbms_output.put_line('TRANSFER_A=COMMIT');
exception when others then rollback; dbms_output.put_line('TRANSFER_A='||sqlcode); end;
/
"@
    Start-Sleep -Milliseconds 700
    $transferB = Start-OracleJob @"
declare pa number; pn number; q number; r number;
begin pkg_vehiculos.transferir_propiedad('actor:101/I02','race-transfer-b',$hRaceTbRequest,101,null,'race-tb',$mainVehicle,$propertyAfterTransfer,201,200,
 'Race transfer B',$hRaceTbQr,null,pa,pn,q,r); commit; dbms_output.put_line('TRANSFER_B=COMMIT');
exception when others then rollback; dbms_output.put_line('TRANSFER_B='||sqlcode); end;
/
"@
    $transferRace = Wait-OracleJobs @($transferA,$transferB)
    Assert-Output 'transfer race winner' ($transferRace -join "`n") 'TRANSFER_A=COMMIT'
    Assert-Output 'transfer race loser' ($transferRace -join "`n") 'TRANSFER_B=-20021'
    Assert-Output 'transfer race final state' (Invoke-OwnerSql "select 'TRANSFER_FINAL='||(select count(*) from propiedad_vehiculo where id_vehiculo=$mainVehicle and hasta_en is null)||':'||(select count(*) from qr_token where id_vehiculo=$mainVehicle and revocado_en is null) from dual;") 'TRANSFER_FINAL=1:1'

    $raceIds = Get-CurrentIds 'P-100'; $raceQrExpected = $raceIds[2]
    # Concurrent QR rotations: same expected generation, one winner.
    $qrA = Start-OracleJob @"
declare q number; r number;
begin pkg_vehiculos.rotar_qr('actor:100/I02','race-qr-a',$hRaceQaRequest,100,null,'race-qa',$mainVehicle,$raceQrExpected,
 'Race QR A',$hRaceQaToken,null,q,r); dbms_session.sleep(3); commit; dbms_output.put_line('QR_A=COMMIT');
exception when others then rollback; dbms_output.put_line('QR_A='||sqlcode); end;
/
"@
    Start-Sleep -Milliseconds 700
    $qrB = Start-OracleJob @"
declare q number; r number;
begin pkg_vehiculos.rotar_qr('actor:101/I02','race-qr-b',$hRaceQbRequest,101,null,'race-qb',$mainVehicle,$raceQrExpected,
 'Race QR B',$hRaceQbToken,null,q,r); commit; dbms_output.put_line('QR_B=COMMIT');
exception when others then rollback; dbms_output.put_line('QR_B='||sqlcode); end;
/
"@
    $qrRace = Wait-OracleJobs @($qrA,$qrB)
    Assert-Output 'QR rotation race winner' ($qrRace -join "`n") 'QR_A=COMMIT'
    Assert-Output 'QR rotation race loser' ($qrRace -join "`n") 'QR_B=-20031'
    Assert-Output 'QR rotation final state' (Invoke-OwnerSql "select 'CURRENT_QR='||count(*) from qr_token where id_vehiculo=$mainVehicle and revocado_en is null;") 'CURRENT_QR=1'

    # Direct concurrent insertion independently proves the conditional QR index.
    Invoke-OwnerSql @"
insert into vehiculo(id_vehiculo,codigo_tipo,placa,marca,modelo,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
 values(8001,'AUTOMOVIL','RACE-QR','M','X',1,systimestamp,100,systimestamp,100,1);
commit;
"@ | Out-Null
    $rawQrA = Start-OracleJob @"
begin insert into qr_token(id_vehiculo,token_hash,emitido_en,emitido_por,id_comando) values(8001,standard_hash('raw-qr-a','SHA256'),systimestamp,100,9000);
 dbms_session.sleep(3); commit; dbms_output.put_line('RAW_QR_A=COMMIT'); exception when others then rollback; dbms_output.put_line('RAW_QR_A='||sqlcode); end;
/
"@
    Start-Sleep -Milliseconds 700
    $rawQrB = Start-OracleJob @"
begin insert into qr_token(id_vehiculo,token_hash,emitido_en,emitido_por,id_comando) values(8001,standard_hash('raw-qr-b','SHA256'),systimestamp,101,9000);
 commit; dbms_output.put_line('RAW_QR_B=COMMIT'); exception when others then rollback; dbms_output.put_line('RAW_QR_B='||sqlcode); end;
/
"@
    $rawQrRace = Wait-OracleJobs @($rawQrA,$rawQrB)
    Assert-Output 'raw QR race winner' ($rawQrRace -join "`n") 'RAW_QR_A=COMMIT'
    Assert-Output 'raw QR race loser' ($rawQrRace -join "`n") 'RAW_QR_B=-1'
    Assert-Output 'raw QR race final state' (Invoke-OwnerSql 'select ''RAW_CURRENT_QR=''||count(*) from qr_token where id_vehiculo=8001 and revocado_en is null;') 'RAW_CURRENT_QR=1'

    $version = Invoke-SysSql "select 'ORACLE_VERSION='||version_full from product_component_version where product like 'Oracle Database%';"
    $evidence = Invoke-OwnerSql @"
select 'I02_COUNTS='||(select count(*) from tipo_vehiculo)||':'||(select count(*) from vehiculo)||':'||(select count(*) from propiedad_vehiculo)||':'||(select count(*) from qr_token) from dual;
select 'CURRENT_INVARIANTS='||(select count(*) from (select id_vehiculo from propiedad_vehiculo where hasta_en is null group by id_vehiculo having count(*)>1))||':'||(select count(*) from (select id_vehiculo from qr_token where revocado_en is null group by id_vehiculo having count(*)>1)) from dual;
select 'SECRET_COLUMNS='||count(*) from user_tab_columns where table_name in ('COMANDO','AUDITORIA_EVENTO') and column_name like '%TOKEN%';
"@
    Assert-Output 'final ownership/QR invariants' $evidence 'CURRENT_INVARIANTS=0:0'
    Assert-Output 'no token column in command/audit' $evidence 'SECRET_COLUMNS=0'

    Write-Output 'PASS I02 structure: four tables, exact seeds, canonical types/nullability, enabled constraints, indexes, owner projection, and valid package.'
    Write-Output 'PASS I02 transactions: T24, T10, and T11 success, rollback, stale-version, same-owner, and idempotent replay cases.'
    Write-Output 'PASS I02 concurrency: independent Oracle sessions forced property, transfer, QR-rotation, and current-QR races; exactly one winner/current row.'
    Write-Output 'PASS I02 runtime security: TT_APP analogue has three readiness SELECT grants and both complete package EXECUTEs; no DDL, direct DML, table/hash SELECT, or quota.'
    Write-Output "ORACLE_EVIDENCE $($version -replace '\s+',' ')"
    Write-Output "I02_EVIDENCE $($evidence -replace '\s+',' ')"
}
finally {
    Get-Job -ErrorAction SilentlyContinue | Where-Object State -eq 'Running' | Stop-Job -ErrorAction SilentlyContinue
    Get-Job -ErrorAction SilentlyContinue | Remove-Job -Force -ErrorAction SilentlyContinue
    if ($runtimeCreated -and $runtime -match '^TT_TEST_APP_[A-F0-9]{12}$') { Invoke-SysSql "drop user $runtime;" | Out-Null }
    if ($ownerCreated -and $schema -match '^TT_TEST_[A-F0-9]{12}$') { Invoke-SysSql "drop user $schema cascade;" | Out-Null }
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
}
