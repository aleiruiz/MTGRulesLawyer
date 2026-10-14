# MTG Rules Lawyer

MTG Rules Lawyer is a free judge for Magic: The Gathering. You describe what is happening at the table in plain words ("I attack with a deathtouch double striker into an indestructible blocker"), confirm which cards you mean, and get a ruling that cites the Comprehensive Rules, the Oracle text and the official card rulings it is based on. It answers in English or Spanish and runs on the web at [mtgruleslawyer.io](https://mtgruleslawyer.io), with Android on the way.

The goal is simple: settle rules arguments at the table quickly, show the evidence so players can check it, and stay free. There are no ads and no paid features. Donations only cover the server and AI costs.

## What it does

- **Asks the judge.** An AI reads the question, finds the cards it mentions, and lets the player fix any wrong match before a ruling is made.
- **Cites its sources.** Each ruling is checked against the active rules and card snapshot; a citation that does not exist is never shown as valid, and an answer the evidence does not support comes back as uncertain or asks for the missing fact.
- **Keeps the basics in view.** The stack, priority, layers, phases and steps, state-based actions, loops and basic combat are always part of the prompt, because those answers must never be wrong.
- **Lets players dispute a ruling.** Signed-in players can challenge an answer; a human judge reviews it in the app, and approved cases can become regression tests.
- **Stays current.** The Comprehensive Rules, Scryfall Oracle cards and official rulings are refreshed daily, and Spanish card names weekly.
- **Shares rulings.** Every ruling has a read-only public page that works in any browser.

## Known gaps and where help is welcome

These are the open problems we know about. Issues and pull requests on any of them are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md) first.

- **Judge accuracy on tricky interactions.** Most questions are answered correctly, but hard cases (layer and type-changing interactions such as Urborg with Blood Moon, deathtouch and indestructible with double strike) depend on the model's reasoning effort, and lower effort misses some of them. More benchmark cases and better evidence retrieval help most. Run the judge benchmark with `pnpm eval:judge` (it calls OpenAI and costs money; use `--only` to run a few cases).
- **Card recognition from free text.** Card names are found by the AI and then resolved exactly in code. Nicknames, partial names, plurals and unusual phrasing can still pick the wrong card or count, which is why the player confirms cards before the ruling.
- **Spanish.** The interface and answers are bilingual, but the Comprehensive Rules exist only in English and rules search uses English text analysis, so Spanish questions rely on the model to bridge the two.
- **iOS.** There is no iOS release yet and Apple sign-in is hidden until there is. Web and Android come first.
- **End-to-end testing on devices.** There are no automated UI tests for the app, and the full journey (question, card correction, ruling, dispute, review) has not been checked on both platforms ([TASKS.md](TASKS.md) L01).
- **Cost.** Every ruling is a paid model call. Usage is capped per player and per day, and answers are cached briefly, but cheaper ways to answer (for example matching card names without a model call) are open.
- **License.** The code is public but has no license file yet, so it is not formally open source. Choosing one is pending.
- **Production backups.** The hosted database has no automatic backups by choice; rules and cards can be re-imported, but saved rulings and disputes would be lost.

The remaining MVP checklist lives in [TASKS.md](TASKS.md), and the design and architecture in [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) and [docs/architecture.md](docs/architecture.md).

## Support the project

MTG Rules Lawyer is free and will stay free. If it settles an argument for you, a donation on Ko-fi helps pay for the server and the AI judge. The Ko-fi link will be added here and in the web app's account screen.

## Unofficial Fan Content

This project is not affiliated with, endorsed, sponsored, or specifically approved by Wizards of the Coast. Magic: The Gathering, its game rules, cards, and related marks belong to Wizards of the Coast LLC and their respective owners. Read the [Wizards Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy). Card data and images come from [Scryfall](https://scryfall.com/docs/api/bulk-data); see the [source and image use decision](docs/source-policy.md) for import, attribution, and display requirements.

## Start locally

### Requirements

- Node.js 22 or newer
- pnpm 9.15.9 (the repository pins the package manager)
- Docker Desktop or another Docker Compose provider for the local PostgreSQL service
- An Android emulator, iOS simulator, or Expo Go on a device for the mobile app

No OpenAI or OAuth credentials are needed to start the API or app. Values in `.env.example` are local placeholders; do not replace them with production secrets or commit a populated environment file.

### Install and configure

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env
Copy-Item .env.example apps/api/.env
```

Start the local database:

```powershell
docker compose up -d db
```

The API's Prisma client and schema use this database. To create the tables and idempotent empty development snapshot, run:

```powershell
pnpm db:dev
```

Useful database commands:

```powershell
pnpm db:migrate # Apply checked-in migrations to a local or deployment database
pnpm db:format  # Format the Prisma schema
pnpm db:seed    # Recreate the idempotent local development seed
pnpm db:reset   # Drop and recreate the local schema, apply migrations, and seed
pnpm db:backup  # Write a PostgreSQL custom-format dump under .backups/
pnpm db:restore # Restore a dump into an explicit replacement database
pnpm db:rehearse-restore # Verify dump/restore against a disposable database
```

`db:reset` deletes data in the configured database. Use it only with the local database above, never with a shared or production URL. The seed snapshot is an empty candidate; it contains no rules or card data.

See [operations and recovery](docs/operations.md) for health probes, monitoring events, cost alerts, and backup/restore instructions. Backup commands require PostgreSQL client tools; restore commands require an explicit confirmation and should target a replacement or disposable database.

With the local database running, populate private development source snapshots from the official sources:

```powershell
pnpm rules:import  # Fetch and validate the current Comprehensive Rules TXT
pnpm oracle:import # Download and import the current Scryfall Oracle Cards bulk file
pnpm sources:refresh # Check both sources and safely activate any changes
pnpm sources:check   # Fail when source checks are stale or the last refresh failed
```

These commands require network access but no API credentials. They store source metadata and checksums in PostgreSQL and keep the full bulk files in temporary local storage only. Keep imported rules and Oracle text private; see [the source use decision](docs/source-policy.md) before exposing source material or image references publicly. Exact face names can be looked up locally at GET /api/cards/lookup?name=Dauntless%20Avenger.

`pnpm sources:refresh` records each source check as `RUNNING`, `UNCHANGED`, `IMPORTED`, or `FAILED` in PostgreSQL. It checks rules by content checksum and checks Scryfall's Oracle Cards update timestamp before downloading the bulk file. `GET /api/sources/status` reports the active snapshot, source versions, last check, and stale status without returning imported rules or card text. The stale threshold defaults to 72 hours and can be changed with `SOURCE_STALE_AFTER_HOURS`.

In production the server runs these refreshes daily; see [deployment](docs/deploy.md). The manual **Source refresh** GitHub Actions workflow does the same for a database GitHub can reach.

In one terminal, start the API:

```powershell
pnpm dev:api
```

In another terminal, start Expo:

```powershell
pnpm dev:mobile
```

The iOS simulator and web preview use `http://localhost:3000` by default. Android emulators use `http://10.0.2.2:3000`. To use a physical device, set `EXPO_PUBLIC_API_URL` to the computer’s LAN address before starting Expo:

```powershell
$env:EXPO_PUBLIC_API_URL = "http://192.168.1.20:3000"
pnpm dev:mobile
```

Replace the example address with the computer’s LAN address. The device and computer must be on the same network, and the API listens on `0.0.0.0` by default.

After a ruling is generated, use **Open public ruling** to view its read-only page. Web builds use their current origin for share links. Native builds can use `EXPO_PUBLIC_WEB_URL` to point links at the deployed web app; the local example points to the Expo web preview.

For a hosted web build, set `EXPO_PUBLIC_API_URL` to the public HTTPS origin of the deployed API before exporting the app. The browser calls that origin to load anonymous rulings, so a blank value is only suitable for local development. Set the API's `CORS_ALLOWED_ORIGINS` to that web app's exact HTTPS origin; with `NODE_ENV=production` and no list, browsers cannot call the API from any other site.

Check the API directly at `http://localhost:3000/health`. `POST /api/questions/interpret` accepts a JSON body such as `{"question":"Can I respond to a spell in Magic?"}` and returns an in-scope decision, scenario facts, highlighted mention spans, and exact Oracle card choices. Calling it requires the server-side OpenAI and AI quota settings from `.env`; the API and mobile app still start with the example placeholders. Stop the database with `docker compose down`; `docker compose down -v` also removes its local data.

## Common commands

```powershell
pnpm lint
pnpm lint:fix
pnpm format
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm audit:check
```

The Expo build exports Android, iOS, and web bundles. It does not create installable native release builds; see [Android release](docs/android-release.md) for the Google Play build with EAS.

## Project map

See [docs/architecture.md](docs/architecture.md) for the workspace map, runtime boundaries, and planned data flow. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and pull request checklist.

### Optional OpenAI adapter smoke test

The API starts without an OpenAI key. Model credentials are read only when a server-side model request is created; never set them with an `EXPO_PUBLIC_` prefix. Copy `.env.example` to `.env` and set a valid `OPENAI_API_KEY` only when running the opt-in provider smoke test. The default model is `gpt-6-luna`; timeout and output token limits are bounded by the API configuration. Run `pnpm --filter @mtg-rules/api exec tsx --test src/ai/openai.test.ts` for mocked adapter tests, or set `RUN_OPENAI_SMOKE_TEST=true` and run that command to include one live request.

### AI usage controls

Production AI endpoints must call providers through `runReservedAiCall` in `apps/api/src/ai/usage.ts`. It reserves quota, global daily cost, and an in-flight slot in PostgreSQL before invoking the provider, marks the reservation in progress before the call, then records actual reported cost or retains the conservative reservation when a provider call fails. Anonymous and account quotas use rolling 24-hour windows; a short per-IP burst cap applies to both. IPs and account identifiers are HMACed with `AI_RATE_LIMIT_HASH_KEY` before storage, so raw IP addresses are not saved in usage records. Generate that key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and keep it server-side. If the API runs behind a proxy, set `TRUSTED_PROXY_IPS` to the proxy's specific IP addresses or CIDRs so Fastify can read the client address safely; do not trust arbitrary forwarded headers. The defaults are 10 anonymous / 30 account interpretations, 3 anonymous / 10 account rulings, 8 calls per IP per minute, $5 reserved cost per rolling day, $0.02 reserved per call, and 5 simultaneous provider calls. Tune the per-call reserve to at least the worst-case cost for the configured prompt and output limits. Set `AI_EMERGENCY_STOP=true` and restart the API to stop all new AI calls; quota responses include `Retry-After`.

## Security

Do not commit API keys, OAuth credentials, database passwords, or populated `.env` files. Report suspected vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
