# Architecture map

## Current workspace

```text
apps/mobile/        Expo Router and React Native screens
apps/api/           Fastify HTTP application and server entry point
packages/contracts/ Zod schemas shared at API and mobile boundaries
```

The mobile app calls the API and validates the response with shared contracts. The API owns server-side behavior and is the only boundary for database and model access. It implements `GET /health`, `GET /api/cards/lookup?name=...`, `GET /api/sources/status`, and `POST /api/questions/interpret`. The interpretation route sends a bounded question through the server-side OpenAI adapter and atomic PostgreSQL AI usage reservation service, validates the scenario output, and resolves mentioned card names against the active local Oracle snapshot. Its bounded evidence assembly service uses local PostgreSQL card and rule snapshots. Rules and Oracle imports create versioned snapshots; ruling generation and authentication remain in development.

## Planned data flow

```mermaid
flowchart LR
  Mobile[Expo mobile app] -->|validated HTTP requests| API[Fastify API]
  API --> Contracts[Shared Zod contracts]
  Mobile --> Contracts
  API -->|lookups and snapshots| DB[(PostgreSQL via Prisma)]
  API -->|server only| Model[OpenAI Responses API adapter]
  API -->|reserve before provider calls| Quotas[AI usage and cost controls]
  Quotas --> DB
  Sources[Rules and Oracle bulk import jobs] -->|private snapshots| DB
```

The contract package defines external request and response shapes. API routes should validate input before calling domain services. Domain services should accept ordinary typed values rather than Fastify or React Native objects. Database queries, source imports, retrieval, model calls, and authorization decisions belong on the server.

`apps/api/src/search/retrieval.ts` performs case-insensitive exact face matching against an indexed name, full-text rule matching through PostgreSQL, and bounded expansion of matched rules' parents and outbound references. The evidence packet identifies its immutable snapshot and source metadata so later ruling operations can persist citations to the exact imported records.

`apps/api/src/sources/refresh.ts` serializes daily/manual source checks so each snapshot activation copies the other active dataset. Every run is logged in `SourceRefreshLog`; the status route exposes active source metadata and stale/failure signals without exposing imported text. GitHub Actions runs this workflow daily and on demand when the repository's `DATABASE_URL` secret is configured.

## Repository locations

- `apps/mobile/app`: Expo Router screens.
- `apps/mobile/src`: mobile features and API client as they are added.
- `apps/api/src`: Fastify setup and HTTP routes.
- `packages/contracts/src`: schemas and shared types.
- `prisma`: database schema and migrations, introduced by F05.
- `scripts`: local maintenance and validation commands.
- `docs`: architecture and source decision records.

Keep secrets in server-side environment configuration. Never put an OpenAI key or OAuth client secret in an `EXPO_PUBLIC_*` variable; Expo embeds those public variables in the client bundle.
