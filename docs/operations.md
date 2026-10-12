# Operations and recovery

## Health and alerts

- Probe `GET /health` for API process liveness and `GET /ready` for PostgreSQL readiness. `/ready` returns 503 when the database cannot answer a query.
- Poll `GET /api/sources/status` and alert when either source is stale or its last status is `FAILED`. The daily Source refresh workflow also fails when sources are stale.
- Send API JSON logs to the deployment's retained log service. Alert on `api.request.failed` (5xx), sustained 429s, `openai.request.failed`, and `ai.usage.limit_reached` with reason `AI_EMERGENCY_STOP` or `AI_GLOBAL_COST_LIMIT`. The operational API events use route templates and do not include question bodies.
- `openai.request.completed` includes model, prompt version, token counts, and duration. Alert when at least 20% of model requests in a rolling five-minute window take 30 seconds or longer; alert immediately when a request reaches the configured timeout (`OPENAI_TIMEOUT_MS`, 45 seconds by default). Actual or reserved cost is stored in `AiUsageReservation`; the daily workflow runs `pnpm ops:ai-usage` and fails when the total reaches `AI_DAILY_COST_ALERT_MICROS` (80% of the configured global ceiling by default). Set the repository variables `AI_GLOBAL_DAILY_COST_LIMIT_MICROS` and `AI_DAILY_COST_ALERT_MICROS` to match the API deployment. Configure GitHub Actions failure notifications for the repository so source or spend alerts reach the on-call maintainer.
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

## Production network settings

Run the API with `NODE_ENV=production`. Set `CORS_ALLOWED_ORIGINS` to the exact HTTPS origins of the hosted web app (for example `https://rules.example`, no path or trailing slash); leaving it empty in production blocks cross-origin browser calls, while the Android and iOS apps are unaffected because they send no `Origin` header. Set `TRUSTED_PROXY_IPS` only to the addresses or CIDR ranges of the reverse proxy in front of the API, so per-IP quotas use the real client address. Wildcards, hostnames, malformed entries and proxy ranges broader than /8 (IPv4) or /16 (IPv6) stop the API at startup instead of falling back to a permissive value.

## Account deletion

Signed-in players delete their account from the sign-in screen (`DELETE /api/me`), at most three attempts per account per hour on each API process; an admin account also needs the same fresh authenticator check as other admin actions. Deletion is immediate, as decided by the maintainer on 2026-10-12. In one transaction the API removes the `AppUser`, its usage windows and every challenge no admin has reviewed; reviewed challenges stay for the audit record with no user link, their explanation replaced by a removal notice, no proposed outcome, evaluation consent withdrawn and any admin-authored evaluation fixture cleared; review events an admin made keep their decision and reason without the reviewer link. A challenge that only received an information request stays in the review queue with the removal notice so an admin can close it. Database backups keep deleted accounts until they rotate out. Saved judge conversations are deleted; the account's questions lose their user and conversation links, so shared rulings keep working without saying who asked. The API then deletes the Supabase Auth user with `SUPABASE_SECRET_KEY` (server only); without that key the endpoint answers `503` and deletes nothing. If the app data is gone but the Supabase call fails, the endpoint answers `502` and the player can repeat the deletion. If a request still carrying the old token recreated an app record while the identity was being deleted, the API removes it afterwards; if that cleanup fails twice it logs `account.cleanup_failed`, and the maintainer should delete `AppUser` rows whose Supabase user no longer exists. Re-run the reviewed-case export after a deletion so committed fixtures drop that player's cases.

## Web research

When a ruling comes back `uncertain`, the API makes one more attempt with OpenAI's web search tool (at most one search, `AI_WEB_RESEARCH=true` by default; set `false` to turn it off). The search only helps the model find which supplied rules and card text decide the answer: pages are untrusted, never cited, and the research answer is used only if it passes the same citation verification, settles the question and contains no links or web addresses; otherwise the first answer stands. Before web research (and even with `AI_WEB_RESEARCH=false`), an uncertain answer that names Comprehensive Rules it needs but was not given, in `neededRuleNumbers` or by citing them, gets one more attempt with those rules' real text added (at most six). That attempt is reserved as its own `RULING_RETRY` usage kind with the same daily limits as rulings, counts toward the global daily cost ceiling, and logs `ruling.requested_rules.completed` or `ruling.requested_rules.skipped`. Each further attempt is skipped when it could outlast the cache transaction (about two minutes). A question can use four of the per-IP burst slots (interpretation, ruling, retry, research). The web research attempt is reserved as a separate `RULING_RESEARCH` usage kind with the same daily limits as rulings, counts toward the global daily cost ceiling, and records US$0.01 per search on top of token cost when cost rates are configured. Logs record `ruling.web_research.completed` with the outcome and the number of searches and sources, never URLs or question text.

## Judge notes

When web research settles a question (resolved or conditional, verified, no links), the API saves a `JudgeNote` with the confirmed cards' Oracle IDs, the verified conclusion and reasoning, the cited rule numbers and up to five source URLs. Later questions about the same cards in the same rules and cards snapshot get up to three such notes as `verifiedNotes` guidance in the prompt, so they usually need no new search; the answer must still cite packet evidence. Notes are used automatically, as decided by the maintainer on 2026-10-12. They never store the player's question, and research is told to state conclusions generically, without player names or game-specific details; the model text can still restate the scenario, so review notes like other shared rulings. Notes are not shown to players, are treated as untrusted hints in the prompt, and their source URLs are never sent to the model. Notes stop applying when a new snapshot activates, and approving a challenge deletes the notes about that ruling's exact cards. To review or remove notes by hand, query the `JudgeNote` table; deleting rows is safe.

## Official card rulings

The Oracle refresh also downloads Scryfall's rulings bulk file and keeps only the rulings Wizards of the Coast published (`source: "wotc"`), stored per card in the same snapshot (`CardRuling`, source `OFFICIAL_RULINGS`). A new rulings file alone produces a new snapshot. For each confirmed card the judge sees every official ruling, whole and never cut or left out (decided by the maintainer on 2026-10-12, after a cut ruling made the judge answer the opposite of the full one), ordered with the most relevant to the question first (those naming another confirmed card first), and can cite them; the app labels those citations "<card> ruling (<date>)", separate from rules and Oracle text.

## Judge benchmark

`pnpm eval:judge` answers the real rules questions in `apps/api/src/rulings/benchmark-cases.json` against the active local snapshot the way the app does (interpretation, then a verified ruling; no web research), and a second model grades each answer against the expected verdict as correct (1), partially correct (0.5) or incorrect. Uncertain answers score 0. It calls OpenAI, so it costs money, and needs `DATABASE_URL` with imported sources; it writes nothing to the database. Options: `--runs 3` (the model varies between runs), `--only M1,H3`, `--level hard`, `--out results.json`. Add a case for every wrong ruling a player reports, with the expected answer checked against the rules and official rulings, and compare scores before and after each judge change.
