# TallerTrack database foundation

TallerTrack uses Flyway Command-line 13.6.0 for ordered, immutable Oracle migrations. Flyway owns the `flyway_schema_history` table, records each applied migration and its checksum, reports pending/applied state, and rejects an applied versioned migration whose contents later change.

The repository bootstrap downloads the official Windows distribution from Redgate, verifies its published SHA-1, and extracts it under the ignored `.tools/` directory. The database process does not depend on the API runtime and must never run automatically when Express starts.

## Accounts and least privilege

- `TT_OWNER` is the deployment identity. I01 needs `CREATE SESSION`, `CREATE TABLE`, `CREATE SEQUENCE` (for Oracle identity columns), and a bounded quota. Later increments must add only the object-creation privileges required by their reviewed migrations.
- `TT_APP` is the application runtime identity. It has no quota, DDL, or direct DML. TT-013 grants only `CREATE SESSION` and `SELECT` on the three objects required for readiness: `flyway_schema_history`, `CONFIG_TALLER`, and `ROL`.
- `TT_QR_READ` is likewise deferred until the public QR read path and its views exist.

For a local development owner, connect to `XEPDB1` as an authorized Oracle administrator, choose the password outside the repository, and execute the equivalent of:

```sql
CREATE USER TT_OWNER IDENTIFIED BY "<local-secret>"
  DEFAULT TABLESPACE USERS
  TEMPORARY TABLESPACE TEMP
  QUOTA 20M ON USERS;
GRANT CREATE SESSION, CREATE TABLE, CREATE SEQUENCE TO TT_OWNER;
```

The repository provides the separate, explicit bootstrap equivalent below. It uses local `sqlplus / as sysdba`, prompts for the new password without echo, does not accept it in a command argument, and is never called by the application or Flyway:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File database/scripts/bootstrap-tt-owner.ps1
```

The bootstrap does not run if `TT_OWNER` already exists. Account lifecycle and password rotation remain administrative operations outside application startup.

After `TT_OWNER` has V001–V004 applied, establish the runtime user through the separate administrator bootstrap. It refuses to replace an existing account, validates the owner objects before creating anything, accepts the password as a `SecureString`, verifies the exact privilege set, and removes a partially configured new account if verification fails:

```powershell
$runtimePassword = Read-Host 'New TT_APP password' -AsSecureString
powershell.exe -NoProfile -ExecutionPolicy Bypass -File database/scripts/bootstrap-tt-app.ps1 -RuntimePassword $runtimePassword
Remove-Variable runtimePassword
```

The application never runs this script and never receives `TT_OWNER` or administrator credentials. Future business migrations may extend the grants only when their package/view contracts exist and are tested; they must not add free table DML.

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

V001 remains the immutable TT-011 technical baseline. I01 then uses three coherent migrations: V002 creates its nine tables and local constraints, V003 closes circular relationships and adds indexes, and V004 inserts the five fixed roles plus the singleton workshop configuration. The canonical audit table is `AUDITORIA_EVENTO`; there is no shortened `AUDITORIA` table. No migration grants runtime access.

## Integration test

With local Oracle XE 21c running and local OS authentication available to `sqlplus / as sysdba`:

```powershell
npm.cmd run test:db:integration
```

The test uses two uniquely named `TT_TEST_*` schemas in `XEPDB1` and the production bootstrap path. It verifies least privilege and password redaction, a clean V001–V004 migration, an upgrade from an existing V001 installation, a second no-op migration, Flyway info/validate, immutable checksums, exact seeds, enabled constraints, critical Oracle types/nullability, conditional indexes, valid coexistence cases, and negative PK/UQ/FK/CHECK/JSON/variant cases. Both guarded schemas are dropped in `finally`.

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
Remove-Variable runtimePassword, credential
npm.cmd start --workspace apps/api
```
