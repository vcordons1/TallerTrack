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
$cleanSchema = "TT_TEST_$(([guid]::NewGuid().ToString('N').Substring(0,12)).ToUpperInvariant())"
$runtime = "TT_TEST_APP_$suffix"
$ownerPassword = "Ow1!$suffix"
$cleanPassword = "Cl1!$suffix"
$runtimePassword = "Ap1!$suffix"
$ownerCreated = $false
$cleanCreated = $false
$runtimeCreated = $false
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('tallertrack-g03b-' + [guid]::NewGuid().ToString('N'))
$throughV011 = Join-Path $tempRoot 'through-v011'
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

function Invoke-SysSql([string]$Sql) {
    $script = @"
whenever sqlerror exit sql.sqlcode
set echo off verify off feedback off heading off pagesize 0 linesize 1400 trimspool on
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
set echo off verify off feedback off heading off pagesize 0 linesize 1400 trimspool on
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

function Set-OwnerEnvironment([string]$User, [string]$Password) {
    $env:TT_DB_URL = 'jdbc:oracle:thin:@//127.0.0.1:1521/XEPDB1'
    $env:TT_DB_USER = $User
    $env:TT_DB_PASSWORD = $Password
}

function Invoke-Flyway([string]$Command) {
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $flyway $Command 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "Flyway $Command failed: $output" }
    return $output
}

function Assert-Output([string]$Label, [string]$Output, [string]$Pattern) {
    if ($Output -notmatch $Pattern) { throw "$Label failed. Expected /$Pattern/ in: $Output" }
}

function Expect-OracleFailure([string]$Label, [string]$Sql, [string]$Code) {
    $output = Invoke-OwnerSql $Sql $false
    if ($output -notmatch "ORA-$Code") { throw "Expected $Label -> ORA-$Code; actual: $output" }
    Write-Output "PASS negative: $Label -> ORA-$Code"
}

try {
    New-Item -ItemType Directory -Path $throughV011 | Out-Null
    Get-ChildItem -LiteralPath $migrations -Filter '*.sql' |
        Where-Object { $_.Name -match '^V00[1-9]__|^V01[01]__' } |
        Copy-Item -Destination $throughV011

    & $ownerBootstrap -SchemaName $cleanSchema -OwnerPassword (ConvertTo-TestSecureString $cleanPassword) | Out-Null
    $cleanCreated = $true
    Set-OwnerEnvironment $cleanSchema $cleanPassword
    Invoke-Flyway 'migrate' | Out-Null
    $cleanEvidence = Invoke-SysSql @"
select 'CLEAN_MIGRATIONS='||count(*) from $cleanSchema."flyway_schema_history" where "success"=1;
select 'CLEAN_TABLES='||count(*) from all_tables where owner='$cleanSchema' and table_name in ('ARCHIVO_PRIVADO','EVIDENCIA');
"@
    Assert-Output 'clean V001-V014 migration count' $cleanEvidence 'CLEAN_MIGRATIONS=14'
    Assert-Output 'clean G03B tables' $cleanEvidence 'CLEAN_TABLES=2'

    & $ownerBootstrap -SchemaName $schema -OwnerPassword (ConvertTo-TestSecureString $ownerPassword) | Out-Null
    $ownerCreated = $true
    Set-OwnerEnvironment $schema $ownerPassword
    $env:FLYWAY_LOCATIONS = 'filesystem:' + $throughV011.Replace('\','/')
    Invoke-Flyway 'migrate' | Out-Null
    Assert-Output 'V011 setup' (Invoke-SysSql "select 'V011_COUNT='||count(*) from $schema.`"flyway_schema_history`" where `"success`"=1;") 'V011_COUNT=11'
    Remove-Item Env:FLYWAY_LOCATIONS
    Invoke-Flyway 'migrate' | Out-Null
    $second = Invoke-Flyway 'migrate'
    $validate = Invoke-Flyway 'validate'
    Assert-Output 'second migrate no-op' $second 'Schema .* is up to date|No migration necessary'
    Assert-Output 'Flyway validation' $validate 'Successfully validated 14 migrations'

    $structure = Invoke-SysSql @"
alter session set current_schema=$schema;
declare
  c number;
  procedure eq(n varchar2, a number, e number) is
  begin if a<>e then raise_application_error(-20190,n||': expected '||e||', got '||a); end if; end;
begin
  select count(*) into c from all_tables where owner='$schema' and table_name in ('ARCHIVO_PRIVADO','EVIDENCIA'); eq('tables',c,2);
  select count(*) into c from all_constraints where owner='$schema' and table_name in ('ARCHIVO_PRIVADO','EVIDENCIA') and status<>'ENABLED'; eq('disabled constraints',c,0);
  select count(*) into c from all_constraints where owner='$schema' and constraint_name in
    ('PK_ARCHIVO_PRIVADO','UQ_ARCHIVO_CLAVE','CK_ARCHIVO_TAMANO','FK_ARCHIVO_CREADOR','PK_EVIDENCIA','UQ_EVIDENCIA_SUSTITUIDA','UQ_EVIDENCIA_CONTEXTO','CK_EVIDENCIA_CONTEXTO','CK_EVIDENCIA_VISIBILIDAD','CK_EVIDENCIA_VARIANTE','CK_EVIDENCIA_RECEPCION_VISIBLE','FK_EVIDENCIA_ORDEN','FK_EVIDENCIA_ARCHIVO','FK_EVIDENCIA_SUSTITUIDA','FK_EVIDENCIA_REGISTRADOR','FK_EVIDENCIA_COMANDO') and status='ENABLED'; eq('critical constraints',c,16);
  select count(*) into c from all_tab_columns where owner='$schema' and table_name='ARCHIVO_PRIVADO' and
    ((column_name='CLAVE_OBJETO' and data_type='VARCHAR2' and char_length=300 and nullable='N') or
     (column_name='MIME_TYPE' and data_type='VARCHAR2' and char_length=100 and nullable='N') or
     (column_name='TAMANO_BYTES' and data_type='NUMBER' and data_precision=14 and data_scale=0 and nullable='N') or
     (column_name='SHA256' and data_type='RAW' and data_length=32 and nullable='N') or
     (column_name='CREADO_EN' and data_type='TIMESTAMP(6) WITH TIME ZONE' and data_scale=6 and nullable='N') or
     (column_name='CREADO_POR' and data_type='NUMBER' and nullable='N') or
     (column_name='INTENCION_CARGA' and data_type='VARCHAR2' and char_length=100 and nullable='N')); eq('archivo columns',c,7);
  select count(*) into c from all_tab_columns where owner='$schema' and table_name='EVIDENCIA' and column_name in
    ('ID_DIAGNOSTICO','ID_TRABAJO','ID_PRESUPUESTO','ID_EVALUACION') and nullable='Y'; eq('future nullable columns',c,4);
  select count(*) into c from all_cons_columns cc join all_constraints co on co.owner=cc.owner and co.constraint_name=cc.constraint_name
    where cc.owner='$schema' and cc.table_name='EVIDENCIA' and cc.column_name in ('ID_DIAGNOSTICO','ID_TRABAJO','ID_PRESUPUESTO','ID_EVALUACION') and co.constraint_type='R'; eq('future deferred FKs',c,0);
  select count(*) into c from all_col_comments where owner='$schema' and table_name='EVIDENCIA' and column_name in
    ('ID_DIAGNOSTICO','ID_TRABAJO','ID_PRESUPUESTO','ID_EVALUACION') and comments like 'FK%deferred%'; eq('deferred FK comments',c,4);
  dbms_output.put_line('STRUCTURE_OK');
end;
/
select 'STRUCTURE_OK' from dual;
"@
    Assert-Output 'G03B structure' $structure 'STRUCTURE_OK'

    Invoke-OwnerSql @"
insert into usuario(id_usuario,tipo_actor,login_normalizado,nombre_mostrado,credencial_hash,version_credencial,activo,creado_en,actualizado_en,version_fila)
 values(100,'INTERNO','g03b.recepcion','Recepcion G03B','TEST_ONLY',1,1,systimestamp,systimestamp,1);
insert into cliente(id_cliente,nombre,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
 values(200,'Cliente G03B',1,systimestamp,100,systimestamp,100,1);
insert into comando(id_comando,ambito,clave_idempotencia,solicitud_hash,tipo_operacion,id_actor,registrado_en,resultado_codigo)
 values(500,'g03b:test','fixture',hextoraw('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),'FIXTURE',100,systimestamp,200);
insert into vehiculo(id_vehiculo,codigo_tipo,marca,modelo,activo,creado_en,creado_por,actualizado_en,actualizado_por,version_fila)
 values(300,'AUTOMOVIL','Marca','Modelo',1,systimestamp,100,systimestamp,100,1);
insert into propiedad_vehiculo(id_propiedad,id_vehiculo,id_cliente,desde_en,motivo,registrado_por,id_comando)
 values(400,300,200,systimestamp,'Propiedad G03B',100,500);
insert into orden_trabajo(id_orden,id_vehiculo,id_propiedad_apertura,id_cliente,proposito,ingresado_en,kilometraje_ingreso,motivo_ingreso,danos_visibles,estado,version_fila,creado_por,id_comando)
 values(600,300,400,200,'COMERCIAL',systimestamp,10,'Ingreso G03B','Sin danos','CANCELADO',1,100,500);
insert into archivo_privado(id_archivo,clave_objeto,mime_type,tamano_bytes,sha256,creado_en,creado_por,intencion_carga)
 values(700,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','image/png',128,hextoraw('BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'),systimestamp,100,'RECEPCION_PREVIA');
insert into evidencia(id_evidencia,id_orden,id_archivo,contexto,visibilidad,descripcion,registrado_en,registrado_por,id_comando)
 values(800,600,700,'RECEPCION','CLIENTE_ATENCION','Recepcion G03B',systimestamp,100,500);
commit;
"@ | Out-Null

    Expect-OracleFailure 'duplicate object key' "insert into archivo_privado(clave_objeto,mime_type,tamano_bytes,sha256,creado_en,creado_por,intencion_carga) values('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','image/png',1,hextoraw('CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'),systimestamp,100,'RECEPCION_PREVIA');" '00001'
    Expect-OracleFailure 'zero object size' "insert into archivo_privado(clave_objeto,mime_type,tamano_bytes,sha256,creado_en,creado_por,intencion_carga) values('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','image/png',0,hextoraw('CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'),systimestamp,100,'RECEPCION_PREVIA');" '02290'
    Expect-OracleFailure 'invalid file actor' "insert into archivo_privado(clave_objeto,mime_type,tamano_bytes,sha256,creado_en,creado_por,intencion_carga) values('cccccccccccccccccccccccccccccccc','image/png',1,hextoraw('CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'),systimestamp,999999,'RECEPCION_PREVIA');" '02291'
    Expect-OracleFailure 'invalid evidence order' "insert into evidencia(id_orden,id_archivo,contexto,visibilidad,descripcion,registrado_en,registrado_por,id_comando) values(999999,700,'RECEPCION','CLIENTE_ATENCION','X',systimestamp,100,500);" '02291'
    Expect-OracleFailure 'invalid evidence context' "insert into evidencia(id_orden,id_archivo,contexto,visibilidad,descripcion,registrado_en,registrado_por,id_comando) values(600,700,'PUBLICA','INTERNA','X',systimestamp,100,500);" '02290'
    Expect-OracleFailure 'invalid evidence visibility' "insert into evidencia(id_orden,id_archivo,contexto,visibilidad,descripcion,registrado_en,registrado_por,id_comando) values(600,700,'ENTREGA','PUBLICA','X',systimestamp,100,500);" '02290'
    Expect-OracleFailure 'reception cannot be internal' "insert into evidencia(id_orden,id_archivo,contexto,visibilidad,descripcion,registrado_en,registrado_por,id_comando) values(600,700,'RECEPCION','INTERNA','X',systimestamp,100,500);" '02290'

    Invoke-OwnerSql @"
insert into evidencia(id_evidencia,id_orden,id_archivo,contexto,visibilidad,descripcion,id_evidencia_sustituida,registrado_en,registrado_por,id_comando)
 values(801,600,700,'RECEPCION','CLIENTE_ATENCION','Correccion',800,systimestamp,100,500);
commit;
"@ | Out-Null
    Expect-OracleFailure 'duplicate evidence replacement' "insert into evidencia(id_evidencia,id_orden,id_archivo,contexto,visibilidad,descripcion,id_evidencia_sustituida,registrado_en,registrado_por,id_comando) values(802,600,700,'RECEPCION','CLIENTE_ATENCION','Duplicada',800,systimestamp,100,500);" '00001'

    & $appBootstrap -OwnerSchema $schema -RuntimeUser $runtime -RuntimePassword (ConvertTo-TestSecureString $runtimePassword) | Out-Null
    $runtimeCreated = $true
    foreach ($table in 'ARCHIVO_PRIVADO','EVIDENCIA') {
        $failure = Invoke-RuntimeSql "insert into $schema.$table select * from $schema.$table where 1=0;" $false
        if ($failure -notmatch 'ORA-(01031|00942)') { throw "Direct INSERT on $table was denied unexpectedly: $failure" }
        $failure = Invoke-RuntimeSql "update $schema.$table set id_comando=id_comando where 1=0;" $false
        if ($failure -notmatch 'ORA-(01031|00942)') { throw "Direct UPDATE on $table was denied unexpectedly: $failure" }
        $failure = Invoke-RuntimeSql "delete from $schema.$table where 1=0;" $false
        if ($failure -notmatch 'ORA-(01031|00942)') { throw "Direct DELETE on $table was denied unexpectedly: $failure" }
    }

    $privileges = Invoke-SysSql "select 'G03B_DML='||count(*) from dba_tab_privs where grantee='$runtime' and owner='$schema' and table_name in ('ARCHIVO_PRIVADO','EVIDENCIA') and privilege in ('SELECT','INSERT','UPDATE','DELETE');"
    Assert-Output 'G03B least privilege' $privileges 'G03B_DML=0'

    Write-Output 'PASS G03B migrations: clean V001->V014, upgrade V011->V014, second migrate no-op, and Flyway validate green.'
    Write-Output 'PASS G03B structure: canonical types/nullability, available FKs, checks, unique object/replacement keys, and four explicitly deferred future FKs.'
    Write-Output 'PASS G03B integrity: invalid size, actors, orders, contexts, visibility, reception privacy, duplicates, and direct runtime DML were rejected.'
}
finally {
    if ($runtimeCreated -and $runtime -match '^TT_TEST_APP_[A-F0-9]{12}$') {
        Invoke-SysSql "drop user $runtime;" | Out-Null
    }
    if ($ownerCreated -and $schema -match '^TT_TEST_[A-F0-9]{12}$') {
        Invoke-SysSql "drop user $schema cascade;" | Out-Null
    }
    if ($cleanCreated -and $cleanSchema -match '^TT_TEST_[A-F0-9]{12}$') {
        Invoke-SysSql "drop user $cleanSchema cascade;" | Out-Null
    }
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
}
