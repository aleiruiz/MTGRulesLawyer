# Operations and recovery

## Health and alerts

- Probe `GET /health` for API process liveness and `GET /ready` for PostgreSQL readiness. `/ready` returns 503 when the database cannot answer a query.
- Poll `GET /api/sources/status` and alert when either source is stale or its last status is `FAILED`. The daily Source refresh workflow also fails when sources are stale.
- Send API JSON logs to the deployment's retained log service. Alert on `api.request.failed` (5xx), sustained 429s, `openai.request.failed`, and `ai.usage.limit_reached` with reason `AI_EMERGENCY_STOP` or `AI_GLOBAL_COST_LIMIT`. The operational API events use route templates and do not include question bodies.
- `openai.request.completed` includes model, prompt version, token counts, and duration. Alert when at least 20% of model requests in a rolling five-minute window take 15 seconds or longer; alert immediately when a request reaches the configured 20-second timeout. Actual or reserved cost is stored in `AiUsageReservation`; the daily workflow runs `pnpm ops:ai-usage` and fails when the total reaches `AI_DAILY_COST_ALERT_MICROS` (80% of the configured global ceiling by default). Set the repository variables `AI_GLOBAL_DAILY_COST_LIMIT_MICROS` and `AI_DAILY_COST_ALERT_MICROS` to match the API deployment. Configure GitHub Actions failure notifications for the repository so source or spend alerts reach the on-call maintainer.
- The emergency cutoff is `AI_EMERGENCY_STOP=true`. This rejects model-backed requests and emits an alert event. Revert it after investigating the spend or provider incident.

## Database backups

For a hosted database, enable the provider's automated daily backups and point-in-time recovery. Set an alert for a failed backup or a missing successful backup in the retention window. Keep backups in encrypted, access-controlled storage separate from the database and retain them according to the deployment's privacy and recovery requirements.

The manual custom-format backup command uses PostgreSQL client tools (`pg_dump`, `pg_restore`) on `PATH` by default. If they are not installed, set `POSTGRES_CLIENT_IMAGE=postgres:17-alpine` to run the tools in Docker. The Docker client mode expects a database reachable from the container; `localhost` is mapped to Docker Desktop's `host.docker.internal`. It does not support file-based TLS certificates, so use native client tools for those connections.

```powershell
pnpm db:backup
```

It reads `DATABASE_URL` and writes a timestamped dump under `.backups/` by default. Set `DB_BACKUP_FILE` to choose an output path. Copy the result to the configured encrypted backup destination; the local ignored folder is not durable backup storage.

Restore into a replacement or disposable database. The script intentionally requires an explicit target and confirmation because `pg_restore --clean` replaces objects present in the backup:

```powershell
$env:DB_BACKUP_FILE = "C:\secure-backups\mtg-rules.dump"
$env:RESTORE_DATABASE_URL = "postgresql://user:password@replacement-host:5432/mtg_rules_lawyer?sslmode=require"
$env:CONFIRM_DATABASE_RESTORE = "YES"
pnpm db:restore
```

After restoring, run `pnpm db:migrate`, check `/ready` and `/api/sources/status`, then point the API at the replacement database. Never rehearse a restore against production. To rehearse against a disposable database, set `DATABASE_URL` to that database and `CONFIRM_DATABASE_RESTORE=YES`, then run:

```powershell
pnpm db:rehearse-restore
```

The rehearsal creates a synthetic marker row, dumps the database, changes the row, restores the dump, verifies the original value, and removes the marker and temporary backup. CI runs the same rehearsal against its disposable PostgreSQL service.

## Admin access

Grant or remove the admin role only with a direct database change by the maintainer; the API reads the role from `AppUser` on every admin request. Every `/api/admin` request also requires a Supabase session at assurance level `aal2` (an authenticator-app code) whose latest sign-in or code check is no older than `ADMIN_AUTH_MAX_AGE_SECONDS` (default one hour, allowed range 60 seconds to one day; any other value stops the API at startup). Keep TOTP multi-factor authentication enabled in the Supabase project. The first time an admin opens the review queue, the app guides them through adding the account to an authenticator app; afterwards it asks for a new code whenever the last check is too old. Denials are logged as `admin.assurance.denied` with the reason only.
