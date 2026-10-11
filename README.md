# MTG Rules Lawyer

MTG Rules Lawyer is an unofficial Magic: The Gathering rules research assistant. The MVP is being built in small, reviewable tasks. The API includes local source import commands and exact card face lookup; question interpretation and rulings are still in development.

This project is not affiliated with, endorsed, sponsored, or specifically approved by Wizards of the Coast. Magic: The Gathering, its game rules, cards, and related marks belong to Wizards of the Coast LLC and their respective owners. Read the [Wizards Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy). Planned card data sources include [Scryfall bulk data](https://scryfall.com/docs/api/bulk-data); see the [source and image use decision](docs/source-policy.md) for import, attribution, and display requirements.

## Start locally

### Requirements

- Node.js 20 or newer
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
```

`db:reset` deletes data in the configured database. Use it only with the local database above, never with a shared or production URL. The seed snapshot is an empty candidate; it contains no rules or card data.

With the local database running, populate private development source snapshots from the official sources:

```powershell
pnpm rules:import  # Fetch and validate the current Comprehensive Rules TXT
pnpm oracle:import # Download and import the current Scryfall Oracle Cards bulk file
```

These commands require network access but no API credentials. They store source metadata and checksums in PostgreSQL and keep the full bulk files in temporary local storage only. Keep imported rules and Oracle text private; see [the source use decision](docs/source-policy.md) before exposing source material or image references publicly. Exact face names can be looked up locally at GET /api/cards/lookup?name=Dauntless%20Avenger.

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

Check the API directly at `http://localhost:3000/health`. Stop the database with `docker compose down`; `docker compose down -v` also removes its local data.

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

The Expo build exports Android, iOS, and web bundles. It does not create installable native release builds.

## Project map

See [docs/architecture.md](docs/architecture.md) for the workspace map, runtime boundaries, and planned data flow. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and pull request checklist.

## Security

Do not commit API keys, OAuth credentials, database passwords, or populated `.env` files. Report suspected vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
