# Deploying to a server with Coolify

Production runs on one VPS managed by [Coolify](https://coolify.io): PostgreSQL, the API and the web app are the three services in [`compose.prod.yaml`](../compose.prod.yaml). Other projects can share the server; Coolify routes each request by its domain.

| Service | Image                                                 | Public address                  |
| ------- | ----------------------------------------------------- | ------------------------------- |
| `db`    | `postgres:17-alpine`                                  | none (private network only)     |
| `api`   | [`apps/api/Dockerfile`](../apps/api/Dockerfile)       | `https://api.mtgruleslawyer.io` |
| `web`   | [`apps/mobile/Dockerfile`](../apps/mobile/Dockerfile) | `https://mtgruleslawyer.io`     |

The API applies pending migrations every time it starts. There are no scheduled database backups (maintainer decision, 2026-10-13): rules and cards can be re-imported, and losing the server loses accounts, history, challenges and judge notes. `pnpm db:backup` still works by hand.

## DNS

Point an `A` record for each public name at the server's IP address: `@` and `api` for this app. Records for other projects on the same server are independent.

## Create the resource

1. In Coolify, open the project and environment, then **New resource → Git Repository (with GitHub App)**. Choose this repository and the `main` branch.
2. Set **Build pack** to **Docker Compose** and **Docker Compose location** to `/compose.prod.yaml`.
3. Set the domains of the services: `api` → `https://api.mtgruleslawyer.io:3000` (the `:3000` tells Coolify the container port; it is not part of the public address) and `web` → `https://mtgruleslawyer.io`. Leave `db` without a domain.
4. Fill the environment variables Coolify lists. `SERVICE_PASSWORD_*` values are generated automatically. The others:

| Variable                                                                | Value                                                                                                                                                                              |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CORS_ALLOWED_ORIGINS`                                                  | `https://mtgruleslawyer.io`                                                                                                                                                        |
| `EXPO_PUBLIC_WEB_URL`                                                   | `https://mtgruleslawyer.io`                                                                                                                                                        |
| `EXPO_PUBLIC_API_URL`                                                   | `https://api.mtgruleslawyer.io`                                                                                                                                                    |
| `OPENAI_API_KEY`                                                        | A key from the OpenAI project used for production.                                                                                                                                 |
| `AI_INPUT_COST_PER_MILLION_MICROS`, `AI_OUTPUT_COST_PER_MILLION_MICROS` | The model's price per million input and output tokens in micro-dollars (US$1.25 → `1250000`), from OpenAI's pricing page. Required so the daily cost ceiling counts large prompts. |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`                              | From the Supabase project's API settings. The web build uses the same two values.                                                                                                  |
| `SUPABASE_SECRET_KEY`                                                   | Server-only secret key; without it account deletion is unavailable.                                                                                                                |

Mark `OPENAI_API_KEY`, `SUPABASE_SECRET_KEY` and the generated passwords as runtime-only (untick **Build Variable** where Coolify shows it) so they never reach an image layer. `TRUSTED_PROXY_IPS` defaults to Docker's private ranges, which works because the API port is never published and only Coolify's proxy can reach it. Everything else has the defaults from [`.env.example`](../.env.example) and can be changed in the same list. The `EXPO_PUBLIC_*` values are compiled into the web app, so change them only with a redeploy.

5. **Deploy.** The web image takes a few minutes the first time.

## Daily maintenance

[`deploy/daily-maintenance.sh`](../deploy/daily-maintenance.sh) refreshes the Comprehensive Rules, Oracle cards and official rulings when they change, refreshes Spanish card names weekly, and fails when sources are stale or the day's AI spend reaches the alert threshold. In the resource's **Scheduled Tasks**, add:

- Name: `daily maintenance`
- Command: `sh deploy/daily-maintenance.sh`
- Container: `api`
- Frequency: `0 8 * * *`

The database starts empty, so run the same command once right after the first deploy (from the task, or in the `api` container's terminal). The first import downloads Scryfall's bulk files and takes several minutes. Then set up **Notifications** in Coolify (email, Discord or Telegram) for failed deployments and scheduled tasks.

## After the first deploy

- Check `https://api.mtgruleslawyer.io/ready` and `https://api.mtgruleslawyer.io/api/sources/status`.
- In Supabase **Authentication → URL Configuration**, set the site URL to `https://mtgruleslawyer.io` and add `https://mtgruleslawyer.io/auth/callback` to the redirect URLs, next to the app callback `mtgruleslawyer://auth/callback`.
- To make an account admin, sign in once, then run in the `db` container's terminal: `psql -U mtg_rules -d mtg_rules_lawyer -c "UPDATE \"AppUser\" SET role = 'ADMIN' WHERE \"supabaseUserId\" = '<Supabase user id>';"`. Admin pages also need an authenticator app ([operations](operations.md#admin-access)).
- Add an uptime check (for example UptimeRobot) on `https://api.mtgruleslawyer.io/health`.
