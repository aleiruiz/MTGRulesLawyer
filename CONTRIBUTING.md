# Contributing

Thank you for helping build MTG Rules Lawyer. Keep each change focused on one task from [`TASKS.md`](TASKS.md), preserve the boundaries in [the architecture map](docs/architecture.md), and open a pull request for review before merging.

## Development setup

Follow the [README local setup](README.md#start-locally). The app and API start with placeholder environment values and do not need private OpenAI or OAuth credentials. For database work, use the local PostgreSQL service from `docker compose up -d db`; never use production data in local development.

## Repository workflow

1. Create a branch from the updated `main` branch. Use a short name such as `codex/d02-rules-import`.
2. Make the smallest change that completes one task and its dependencies.
3. Run the relevant checks. For application changes, run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and the applicable build. CI runs these checks plus Expo config/export, dependency audit, and secret scanning.
4. Update `TASKS.md` only after that task's implementation, review, and merge are complete. If the task is part of the current pull request, leave its checkbox unchecked until a later branch can record the merge.
5. Open a pull request that names the task ID, summarizes user-visible behavior, lists checks and results, and notes schema, source, prompt, or attribution changes where relevant.

Never commit credentials, generated build output, imported bulk card data, or local database files. Do not disable lint rules without a specific explanation. Keep external input validation in shared contracts and keep framework and storage details out of domain logic.

## Adding regression coverage

Add a focused test when a change alters behavior that can regress: malformed input handling, source import rollback, card-face resolution, citations, authorization, quota accounting, or review transitions. Keep fixtures small and synthetic where possible. Do not add real user questions, private data, or unreviewed rulings as training data.

## Rules and card sources

Before adding imported rules, cards, or images, review the current [Wizards Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy), [Scryfall bulk data documentation](https://scryfall.com/docs/api/bulk-data), and [Scryfall API access guidance](https://scryfall.com/docs/faqs/i-m-having-trouble-accessing-the-scryfall-api-or-i-m-blocked-17). Record applicable attribution, source date, and use/display limits in the source decision record required by D01. Do not infer that a link to a source grants permission to redistribute its content.
