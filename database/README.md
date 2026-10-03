# TallerTrack database foundation

TallerTrack uses Flyway Command-line 13.6.0 for ordered, immutable Oracle migrations. Flyway owns the `flyway_schema_history` table, records each applied migration and its checksum, reports pending/applied state, and rejects an applied versioned migration whose contents later change.

The repository bootstrap downloads the official Windows distribution from Redgate, verifies its published SHA-1, and extracts it under the ignored `.tools/` directory. The database process does not depend on the API runtime and must never run automatically when Express starts.

## Accounts and least privilege

- `TT_OWNER` is the deployment identity. I02 needs `CREATE SESSION`, `CREATE TABLE`, `CREATE SEQUENCE`, `CREATE VIEW`, `CREATE PROCEDURE`, and a bounded quota. Later increments must add only the object-creation privileges required by their reviewed migrations.
- `TT_APP` is the application runtime identity. It has no quota, DDL, direct DML, or arbitrary table reads. It receives `CREATE SESSION`, `SELECT` on the three readiness objects (`flyway_schema_history`, `CONFIG_TALLER`, and `ROL`), and `EXECUTE` only on nine bounded runtime facades: `PKG_VEHICULOS`, `PKG_AGENDA`, `PKG_IDENTIDAD`, `PKG_RECEPCION_HTTP`, `PKG_CONSULTAS_CLIENTES_VEHICULOS`, `PKG_CONSULTAS_ORDENES`, `PKG_DIAGNOSTICO_GRATUITO`, `PKG_USUARIOS_INTERNOS`, and `PKG_CLIENTES_VEHICULOS_HTTP`. It cannot execute owner-only `PKG_IDENTIDAD_BOOTSTRAP` nor the internal T01 package `PKG_ORDENES`: V022 revokes that grant, so order opening is reachable only through `PKG_RECEPCION_HTTP`, which requires a live session with the current credential version and the RECEPCIONISTA role. `PKG_VEHICULOS` remains directly executable and does not check roles itself (known limitation).
- `TT_QR_READ` is likewise deferred until the public QR read path and its views exist.

For a local development owner, connect to `XEPDB1` as an authorized Oracle administrator, choose the password outside the repository, and execute the equivalent of:

```sql
CREATE USER TT_OWNER IDENTIFIED BY "<local-secret>"
  DEFAULT TABLESPACE USERS
  TEMPORARY TABLESPACE TEMP
  QUOTA 20M ON USERS;
GRANT CREATE SESSION, CREATE TABLE, CREATE SEQUENCE, CREATE VIEW, CREATE PROCEDURE TO TT_OWNER;
```

The repository provides the separate, explicit bootstrap equivalent below. It uses local `sqlplus / as sysdba`, prompts for the new password without echo, does not accept it in a command argument, and is never called by the application or Flyway:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File database/scripts/bootstrap-tt-owner.ps1
```

The bootstrap does not run if `TT_OWNER` already exists. Account lifecycle and password rotation remain administrative operations outside application startup.

After `TT_OWNER` has V001–V021 applied, establish the runtime user through the separate administrator bootstrap. It refuses to replace an existing account, validates the owner objects before creating anything, accepts the password as a `SecureString`, verifies the exact privilege set, and removes a partially configured new account if verification fails:

```powershell
$runtimePassword = Read-Host 'New TT_APP password' -AsSecureString
powershell.exe -NoProfile -ExecutionPolicy Bypass -File database/scripts/bootstrap-tt-app.ps1 -RuntimePassword $runtimePassword
Remove-Variable runtimePassword
```

The application never runs this script and never receives `TT_OWNER` or administrator credentials. For an existing `TT_APP` created before V019, after applying the new migrations the database operator grants `EXECUTE ON TT_OWNER.PKG_DIAGNOSTICO_GRATUITO TO TT_APP`, `EXECUTE ON TT_OWNER.PKG_USUARIOS_INTERNOS TO TT_APP` and, after V021, `EXECUTE ON TT_OWNER.PKG_CLIENTES_VEHICULOS_HTTP TO TT_APP` (`npm.cmd run start:users:local` does this idempotently); no table grants or account replacement are needed. Future business migrations may extend the grants only when their package/view contracts exist and are tested; they must not add free table DML.

Do not reuse this local credential in another environment. Do not place it in a command argument, repository file, shell history, log, or mobile/backend configuration.

## Local configuration and commands

The supported local JDBC URL is `jdbc:oracle:thin:@//127.0.0.1:1521/XEPDB1`. Copy the names from `.env.example` into protected process-level environment variables; the scripts do not load `.env` files. All three variables are required:

```powershell
$env:TT_DB_URL = 'jdbc:oracle:thin:@//127.0.0.1:1521/XEPDB1'
$env:TT_DB_USER = 'TT_OWNER'
$securePassword = Read-Host 'TT_OWNER password' -AsSecureString
$credential = New-Object System.Management.Automation.PSCredential('TT_OWNER', $securePassword)
$env:TT_DB_PASSWORD = $credential.GetNetworkCredential().Password
Remove-Variable securePassword, credential
```

Then run:

```powershell
npm.cmd run db:tool:setup
npm.cmd run db:migrate
npm.cmd run db:info
npm.cmd run db:validate
```

`db:migrate` applies only pending versions. `db:info` shows pending and applied migrations. `db:validate` compares local migrations with Flyway history and fails on checksum/name/type discrepancies. `flyway.cleanDisabled=true` is fixed in repository configuration; TT-011 provides no general-purpose reset command.

To verify the current baseline directly from Oracle while connected as `TT_OWNER`:

```sql
SELECT "version", "description", "checksum", "installed_on", "success"
FROM "flyway_schema_history"
ORDER BY "installed_rank";
```

## Migration and source convention

- `database/migrations/VNNN__description.sql` is the immutable deployment history. Never edit an applied version; add the next ordered migration.
- `database/tests/` contains Oracle integration tests. Tests must use isolated schemas and real Oracle semantics.
- `database/scripts/` contains tooling/bootstrap scripts, not a custom migration engine.
- As later increments require them, add maintainable current sources under `database/tables/`, `constraints/`, `indexes/`, `views/`, `packages/`, `grants/`, and `seeds/`; create each directory only with its first real artifact. Publish every source change through a new migration. Keep database test fixtures under tests, not production seeds.

V001 remains the immutable TT-011 technical baseline. I01 uses V002–V004. I02 uses V005–V008, I03 uses V009–V011, and G-03B uses V012–V013. TT-019 adds V014 with `PKG_ORDENES`; TT-020 adds V015 with `PKG_IDENTIDAD` and owner-only `PKG_IDENTIDAD_BOOTSTRAP`; TT-021 adds V016 with `PKG_RECEPCION_HTTP`; TT-022 adds V017 with bounded read facades for C01/V01/V03 and O01/O03. TT-024 adds V018 (`TRABAJO`, `TRABAJO_EVENTO`, `DIAGNOSTICO`) and V019 (`PKG_DIAGNOSTICO_GRATUITO`). The future `TRABAJO_EVENTO.id_item` FK awaits `PRESUPUESTO_ITEM`; the free diagnostic path deliberately has no item, charge or budget table. TT-025 adds V020 (`PKG_USUARIOS_INTERNOS`) for I10–I14. TT-026 adds V021 without tables: it replaces `PKG_CONSULTAS_CLIENTES_VEHICULOS` (same C01/V01/V03 projections plus C03, V05 and V08; its grant survives `CREATE OR REPLACE`) and creates the command facade `PKG_CLIENTES_VEHICULOS_HTTP` for C02/C04/C05/V02/V04/V06/V07, which revalidates the current A/R session under lock and reuses the T24/T10 transactions of `PKG_VEHICULOS`. V001–V020 remain unchanged. TT-027 adds V022 (T01 appointment, `PKG_RECEPCION_HTTP` hardening, revocation of the direct `PKG_ORDENES` grant). TT-028 adds V023, which replaces only the body of `PKG_DIAGNOSTICO_GRATUITO` so that O06 acquires the actor and destination `USUARIO` rows by ascending ID before the actor `SESION` (architecture §19.1) and evaluates the destination after authorizing the actor; its specification and the TT_APP grant are unchanged. Runtime grants are applied by the explicit bootstrap, not a migration.

For an optional local reception scenario, first provision an internal A/R user, then run `npm.cmd run bootstrap:demo-reception` with the same `TT_BOOTSTRAP_ORACLE_USER`, `TT_BOOTSTRAP_ORACLE_SCHEMA`, `TT_BOOTSTRAP_ORACLE_PASSWORD`, and `TT_BOOTSTRAP_ORACLE_CONNECT_STRING` owner settings used by the internal-user bootstrap. The tool recognizes an existing active client/vehicle/current-property scenario without an active order or creates one through `PKG_VEHICULOS`; it prints only non-sensitive IDs and descriptors.

## Integration test

With local Oracle XE 21c running and local OS authentication available to `sqlplus / as sysdba`:

```powershell
npm.cmd run test:db:integration
```

The aggregate test runs Foundation, I02, I03, G-03B, T01, authentication, free diagnosis, internal users, and customers/vehicles. Foundation verifies clean V001–V023 and upgrade/idempotency. `npm.cmd run test:db:customers-vehicles` upgrades V020→V021 and exercises C01–C05/V01–V08 over real HTTP with a temporary least-privilege runtime. The authentication suite provisions a real internal user and exercises authentication plus the reception/query E2E against Oracle and isolated private storage, including live roles, refresh reuse, logout, property transfer/history, least privilege, rollback and independent-session races. `npm.cmd run test:db:free-diagnostic` starts at V022, upgrades to V023 over fixtures and existing runtime grants (privileges must stay identical), and checks I15/O05–O07 permissions, replay (including the refused replay from another session), concurrent O06/O07, O06 racing a real I13/I14 on the destination account, induced-failure rollback, the technical projection, T01/T02/T04, D01/D02, projection, replay, independent-session races and least privilege against temporary Oracle accounts. Every guarded schema is dropped in `finally`.

TT-013 adds a separate real API integration test. It creates a unique migrated owner and an ephemeral literal `TT_APP`, verifies its exact grants and denied DDL/DML, exercises Express through node-oracledb Thin mode, checks a real incorrect credential, and removes both accounts in `finally`:

```powershell
npm.cmd run test:api:oracle
```

Run the API with protected process environment variables (the names and non-secret defaults are in `apps/api/.env.example`):

```powershell
$env:TT_ORACLE_USER = 'TT_APP'
$runtimePassword = Read-Host 'TT_APP password' -AsSecureString
$credential = [System.Management.Automation.PSCredential]::new('TT_APP', $runtimePassword)
$env:TT_ORACLE_PASSWORD = $credential.GetNetworkCredential().Password
$env:TT_ORACLE_CONNECT_STRING = '127.0.0.1:1521/XEPDB1'
$env:TT_ORACLE_SCHEMA = 'TT_OWNER'
$env:TT_ORACLE_EXPECTED_DATABASE = 'XE'
$env:TT_ORACLE_EXPECTED_SERVICE = 'XEPDB1'
$env:TT_PRIVATE_STORAGE_ROOT = '.data/private-files'
$env:TT_EVIDENCE_MAX_FILE_BYTES = '10485760'
$env:TT_EVIDENCE_MAX_PIXELS = '25000000'
$env:TT_EVIDENCE_MAX_DIMENSION = '8192'
$env:TT_EVIDENCE_MAX_FILES_PER_OPERATION = '10'
Remove-Variable runtimePassword, credential
npm.cmd start --workspace apps/api
```

The relative storage root is resolved from the process working directory and is ignored by Git. Production-like runs must point it at a durable backend-only volume, never a frontend public/static directory. The evidence limits are the provisional TT-017 operational profile, not measured production capacity; see decision 001.
