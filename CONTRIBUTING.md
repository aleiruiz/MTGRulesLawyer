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

## Social sign-in setup

Sign-in uses Supabase Auth with Google, Apple, and GitHub. Copy the Supabase project URL and publishable key into `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; these values configure the mobile client and are not provider secrets. Keep OAuth client secrets in the Supabase provider settings, never in Expo variables or the repository. Add `mtgruleslawyer://auth/callback` to the Supabase Auth redirect URL allow list, then configure each provider's callback URL from the Supabase dashboard. Enable each provider in Supabase before testing its button. The session and PKCE verifier use Expo SecureStore on Android and iOS; the web preview keeps sign-in state in memory only. Local startup continues to work with the sample placeholders, while sign-in buttons remain disabled until project settings are supplied.

Provider setup and device return-flow testing are documented in the [Supabase Expo social-auth guide](https://supabase.com/docs/guides/auth/quickstarts/with-expo-react-native-social-auth) and the [Expo SecureStore reference](https://docs.expo.dev/versions/v54.0.0/sdk/securestore/). Build an Android development app with `pnpm --filter @mtg-rules/mobile native:android` or an iOS development app on macOS with `pnpm --filter @mtg-rules/mobile native:ios`. Test successful sign-in, provider cancellation, expired sessions, and return-to-app deep links on both platforms. Expo Go does not use this app's registered `mtgruleslawyer` scheme.

## Adding regression coverage

Add a focused test when a change alters behavior that can regress: malformed input handling, source import rollback, card-face resolution, citations, authorization, quota accounting, or review transitions. Keep fixtures small and synthetic where possible. Do not add real user questions, private data, or unreviewed rulings as training data.

When changing ruling prompts, schemas, or citation verification, run `pnpm eval:rulings`; CI runs this credential-free replay against expected outcome categories and Comprehensive Rules citations. For a prompt or model change, also run `pnpm eval:rulings:live` with `OPENAI_API_KEY` set to test the current model against the same reviewed layers, replacement effects, triggers, multiplayer, and missing-fact cases. The live check makes model requests and may incur provider usage. The seed-set rule references are checked against the cited official rules edition; update expected results only with an explanation and source review in the pull request.

When submitting a challenge, players can separately opt in to use a de-identified scenario in evaluation; that consent defaults to off. An admin must also select an error category, explicitly include the case, and rewrite its scenario without personal details. To export eligible approved corrections, run `pnpm --filter @mtg-rules/api eval:export-reviewed` with the local database configured. The command requires both consent and admin inclusion, and writes the versioned `apps/api/src/rulings/reviewed-evaluation-cases-v1.json`. It uses the admin-written scenario and omits the original question, game-state notes, challenge explanation, decision reason, and challenge identifier. Review the generated cards, citations, and expected answer for accuracy and personal information before committing the fixture. Rejected, unconsented, and unreviewed cases are excluded. Run `pnpm eval:rulings` after accepting any fixture.

Verified ruling responses are cached for six hours by default (`RULING_CACHE_TTL_MS`, maximum one day). The cache key includes the rules/card snapshot, model, prompt version, question, game state, confirmed Oracle IDs/faces/counts, and bounded evidence prompt. Only schema-valid outputs that pass citation verification enter the cache. A snapshot or prompt/model change therefore triggers a fresh model request. OpenAI token counts are stored with each usage reservation. Set `AI_INPUT_COST_PER_MILLION_MICROS` and `AI_OUTPUT_COST_PER_MILLION_MICROS` to the provider's current rates to record an estimated cost in micro-units; unset rates leave actual cost unknown while the existing reservation remains counted against the global ceiling. The API forwards a client disconnect to the provider and releases reservations cancelled before a provider call begins.

## Rules and card sources

Before adding imported rules, cards, or images, review the current [Wizards Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy), [Scryfall bulk data documentation](https://scryfall.com/docs/api/bulk-data), and [Scryfall API access guidance](https://scryfall.com/docs/faqs/i-m-having-trouble-accessing-the-scryfall-api-or-i-m-blocked-17). Record applicable attribution, source date, and use/display limits in the source decision record required by D01. Do not infer that a link to a source grants permission to redistribute its content.
