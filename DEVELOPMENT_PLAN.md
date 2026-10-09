# MTG Rules Lawyer — development plan

## 1. Goal and boundaries

Build a free, unofficial Expo app for Android and iOS where someone describes a Magic: The Gathering card interaction in ordinary language and receives a reasoned answer grounded in the current Comprehensive Rules and Oracle card text. The answer must show the assumptions it used, the relevant card text and rule numbers, and when it cannot decide from the facts supplied. A user can challenge an answer; a human admin reviews the challenge and records a correction or rejection.

The first release is a **rules research assistant**, not a complete game simulator or an official judge. It should answer common two-to-few-card interactions well, ask for missing game state when necessary, and avoid inventing a definitive outcome. Do not promise that an AI model will automatically learn from every dispute.

### MVP user journeys

1. A player enters a question. The app highlights detected card mentions in the text and shows one image per distinct card in a horizontally scrollable confirmation row. The player confirms or changes each match, can add a missed card, and sees the parsed game state before the ruling runs. Asking and reading rulings require no account.
2. The app produces a short outcome, a step-by-step explanation, cited numbered rules, current Oracle text for each referenced card, assumptions, and the source snapshot dates. It marks an answer **needs more information** or **uncertain** when appropriate.
3. A signed-in user challenges an answer with an explanation and optional proposed outcome/source. They can track its status.
4. An admin sees a queue, compares the original evidence and proposed correction, then approves with a written corrected ruling or rejects with a reason. The decision is recorded in an audit trail.

### Deliberate exclusions for the MVP

No full turn/stack simulation engine, model fine-tuning, on-device AI inference, real-time card API call for every question, user-authored public rulings, payment system, or vector database. Add these only when measured failures justify them.

## 2. Small, maintainable architecture

Use one TypeScript repository with a mobile app and a small API service:

| Part            | Choice                                                                                                       | Why                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Mobile UI       | Expo, React Native, Expo Router, and strict TypeScript                                                       | One shared UI for Android and iOS, including native card-image interactions and deep links.                                      |
| API             | A small Node.js TypeScript service (Fastify)                                                                 | Keeps model keys, source imports, retrieval, and moderation decisions off the phone.                                             |
| Data            | Managed PostgreSQL with Prisma migrations                                                                    | Durable rulings, challenges, sources, and audit records. Use PostgreSQL full-text search and indexed card names first.           |
| Authentication  | Supabase Auth social sign-in with Google, Apple, and GitHub                                                  | Managed OAuth, no app-managed passwords, and a stable user ID for challenges. Anonymous ruling access stays available.           |
| AI              | OpenAI `gpt-6-luna` through the Responses API, behind a backend adapter                                      | Use one model for scenario extraction and grounded ruling drafts; keep the model ID configurable and record it with each ruling. |
| Background work | A scheduled import command                                                                                   | Refresh rules and Oracle data without adding a queue service to the MVP.                                                         |
| Hosting         | One API deployment, Supabase Auth/PostgreSQL, and a scheduled import job; EAS development and release builds | Minimal pieces for a real Android/iOS app.                                                                                       |

Suggested directories: `apps/mobile/app` (Expo Router screens), `apps/mobile/src/features`, `apps/api/src/routes`, `apps/api/src/lib/{auth,cards,rules,ai}`, `packages/contracts` (shared request/response schemas), `prisma`, `scripts/import`, and `tests/fixtures`. Keep retrieval, decision orchestration, and HTTP/UI code in separate modules. Use schemas at every external boundary; avoid framework-specific objects in the core ruling logic. The app talks only to the API for rulings and reviews; the API owns database and model access.

## 3. Trusted sources and import process

**MVP decision:** Keep a versioned, searchable rules/card snapshot on the backend. The Expo app requests only the relevant card previews, rule excerpts, and ruling result. Players do not download the full Comprehensive Rules or install an app update when the rules change. The ruling path does not fetch the rules document or look up every card live from third-party APIs; that would add latency, make one answer depend on multiple external requests, and create avoidable API traffic. Offline access to the full corpus can be considered later if there is demand.

- **Rules:** Download the TXT Comprehensive Rules from the [official rules page](https://magic.wizards.com/en/rules). Parse headings and numbered sections into discrete records; preserve exact rule numbers, parent/child relationships, source URL, publication date when available, import time, and file checksum. Reject an import if parsing or expected section counts look wrong; keep the last good snapshot.
- **Cards:** Use a periodic Scryfall Oracle Cards bulk snapshot for efficient lookup, with card names, faces, Oracle IDs, Oracle text, type line, image references, and source metadata. Scryfall asks high-volume users to use bulk data and to keep API traffic low ([API guidance](https://scryfall.com/docs/faqs/i-m-having-trouble-accessing-the-scryfall-api-or-i-m-blocked-17)). Resolve unusual or disputed text against the [official Gatherer card database](https://gatherer.wizards.com/) before a human correction is published. Do not silently substitute printed text for Oracle text. Images are for visual confirmation; Oracle IDs and text determine the ruling.
- **Optional later source:** Card-specific official rulings and release notes can enrich explanations, but must be labeled separately from the Comprehensive Rules and Oracle text.
- Run a scheduled source check (initially daily) and import when the source file or bulk-data version changes, plus a manual refresh around set/rules releases. Import snapshots atomically: parse and validate a new version, then switch the active pointer only after it passes checks. Display the snapshot date on each answer and retain the IDs/checksums needed to reconstruct an older answer. Re-run affected evaluations after an update. Flag stale snapshots and pause definitive answers if an import fails for too long. Notify the app of the new active version through ordinary API responses; no user action is needed.
- Store only the source data needed for lookup and citation. Before public release, review the [Wizards Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy) and the card data provider's current image and data terms. Keep the service free and plainly unofficial, use the policy's required notice, and avoid bulk republishing rules text or card assets. The policy says fan content cannot require a download to access, so make public rulings readable in a small browser view (Expo web or a simple public page served by the API) while the full experience remains native. Use permitted card-image URLs with attribution; if images cannot be used, show text-only card previews. Linking to sources and quoting the relevant excerpts is preferable to exposing the entire imported corpus.

## 4. Ruling pipeline

OpenAI GPT-6 Luna helps interpret and explain; application code controls source lookup and checks evidence. Use the Responses API with structured outputs for both the parsed scenario and ruling draft. The backend sends only the question and bounded relevant source excerpts, never the entire rules/card corpus. The [official model page](https://developers.openai.com/api/docs/models/gpt-6-luna) confirms the API model ID and structured-output support.

1. **Input:** Accept a bounded question, optional explicit card IDs, and a small structured game-state form (whose turn, phase/step, objects/zones, controller, stack order, choices already made). Strip control characters; limit request size and rate.
2. **Interpret:** Model returns a schema-validated JSON `Scenario` containing an `in_scope` decision, candidate card names, mention spans, entities, events/order, known facts, missing facts, and search terms. Exact card matching and Oracle IDs are resolved by code; never use a model-generated image URL as an identity. Unrelated requests stop here with a brief scope message, without a ruling call. Ambiguous names or decisive missing facts trigger a clarification rather than a guess.
3. **Confirm cards:** Highlight matched mentions in the question and display one card image per distinct Oracle card in a swipeable row, with name, set/printing where known, and a brief Oracle-text preview. Let the user confirm, replace an incorrect match, choose among ambiguous candidates, remove a false positive, or add a missed card. For double-faced cards, provide a face switch within the same card tile. Repeated mentions or multiple copies share one tile with an optional count badge. Persist the confirmed IDs and any chosen printing/face separately; do not start the ruling until card identity is confirmed. Use a text-only fallback when an image is missing or blocked, and provide accessible labels, sufficient touch targets, and screen-reader support.
4. **Retrieve:** Fetch the confirmed cards, keyword/glossary definitions, exact rule references, and text-search matches from the local snapshot. Expand cross-references and parent rules. Bound the evidence set and record every retrieved source ID. Use a second targeted retrieval pass when the first pass reveals a referenced mechanic.
5. **Reason:** Give the model the scenario and retrieved evidence with instructions to distinguish facts, assumptions, and inference. Require structured output: `outcome` (`resolved`, `conditional`, `needs_information`, `uncertain`), concise answer, ordered reasoning steps, cited rule IDs/card IDs, assumptions, and follow-up question if needed. Treat source text and the user question as data, not instructions to the model.
6. **Verify:** Code checks that every cited rule/card exists in the selected snapshot, citations support the displayed excerpts, card IDs match the user's confirmed cards, and the response passes its schema. Unsupported claims or contradictory outcomes fall back to **uncertain**. Never fabricate a source URL or rule number.
7. **Present:** Show the result and evidence with links to official sources, and keep the confirmed card tiles accessible in a row above the answer. Label the response as an AI-assisted, unofficial interpretation. The user can edit the scenario or card selection and rerun it.

This is retrieval-augmented reasoning, not a promise of formal proof. Complex loops, layers, replacement effects, dependencies, tournament policy, and multiplayer edge cases should be explicit evaluation categories. If a question is about tournament procedure rather than game rules, say the current evidence is insufficient and route it out of scope.

## 5. Feedback and improvement loop

Use a small state machine: `open → approved | rejected`, with `needs_more_information` available during review. Only admins can change review status. Keep the original question, parsed scenario, answer, evidence snapshot, challenger text, reviewer identity, decision, timestamp, and revised answer. A challenge should never overwrite the original ruling.

On **approval**, publish a corrected answer linked to the old one, explain the error category (card resolution, missing game fact, retrieval, reasoning, outdated source, or presentation), and add a reviewed scenario to a versioned evaluation set. On **rejection**, record the reason and notify the challenger in the app. Duplicate challenges can link to the same case.

Improvement order:

1. Fix incorrect source data, retrieval, scenario parsing, or prompts in the smallest responsible layer.
2. Add the approved case and nearby variations as regression examples. Run the full evaluation set before changing a model or prompt.
3. Periodically compare candidate model/prompt versions against the current one using reviewed examples, with human checks for citation quality and unjustified certainty.
4. GPT-6 Luna does not currently support fine-tuning, so improve it through reviewed examples, retrieval changes, and prompt revisions. If a later model supports fine-tuning, consider it only after enough clean, consented, diverse reviewed cases exist and an offline held-out evaluation shows a gain. Never train directly on unreviewed challenges or on copyrighted source dumps.

Track: answer correctness on reviewed cases, citation validity, correct uncertainty/clarification behavior, challenge and overturn rates, cost per answer, latency, and source freshness. A low challenge rate alone does not prove accuracy.

## 6. Data model and API shape

Start with these app-owned entities: `AppUser` (Supabase Auth user ID and app role only), `RulesSnapshot`, `RuleSection`, `CardsSnapshot`, `Card`/`CardFace` (including image references), `Question`, `QuestionCard` (confirmed Oracle ID, optional printing/face and copy count), `Ruling` (scenario, output, model/prompt version, source snapshot IDs), `RulingCitation`, `Challenge`, `ReviewEvent`, and short-lived `UsageWindow` counters. Use immutable ruling versions and foreign keys. Supabase Auth manages the social identity records and sessions; the app database needs only the stable user ID and role to attach challenges and admin decisions. The auth provider still stores identity/session data, so this is **minimal storage**, not zero storage. Do not copy passwords, provider tokens, profile photos, names, or email addresses into app tables. Define a deletion path for accounts and questions.

API endpoints:

- `POST /api/questions/interpret`: validate question, enforce abuse limits, return candidate cards with mention spans and possible ambiguities for visual confirmation.
- `POST /api/rulings`: accept confirmed card IDs plus the question and game state, then create and return a ruling or clarification request. Do not trust submitted image URLs or client-supplied Oracle text.
- `GET /api/rulings/:id`: return a public answer and its citations, excluding private challenge details.
- `POST /api/rulings/:id/challenges`: authenticated, rate-limited submission.
- `GET /api/me/challenges`: challenger's own cases.
- `GET /api/admin/challenges` and `POST /api/admin/challenges/:id/decision`: admin-only queue and atomic decision.

Keep business operations in reusable server functions so routes and tests use the same logic. Share versioned request/response schemas with the Expo app; never trust client-provided role, card text, or image URL.

## 7. Auth and application security

- Public questions and answers require no account. Offer **Continue with Google**, **Continue with Apple**, and **Continue with GitHub** for challenges and admin work. These are account-provider sign-ins ("Gmail" users use Google sign-in), with no local password or password reset. Use Supabase Auth's social providers and a native OAuth/deep-link flow, following its [Expo social auth guide](https://supabase.com/docs/guides/auth/quickstarts/with-expo-react-native-social-auth). Ask only for identity scopes needed to authenticate; do not rely on email as a unique identifier or automatically merge accounts by email. Apple may provide a private relay address, which should be respected ([Apple guidance](https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple/)). Explicit account linking can be added later.
- Use a dedicated app URL scheme and verified redirect configuration for Android and iOS. Prefer provider-supported PKCE/native flows; test sign-in, cancel, expired session, and return-to-app behavior on real devices and development builds. Store the Supabase session only in the platform's protected storage via `expo-secure-store`, never in plain AsyncStorage or source code. The phone sends the access token to the API over HTTPS; the API verifies issuer, audience, signature, and expiry using the provider's supported verification mechanism ([Supabase JWT guidance](https://supabase.com/docs/guides/auth/jwts)). Refresh and sign-out use the auth SDK. Do not invent a custom JWT format.
- Admin status is set through a controlled server-side process, never from OAuth profile fields, email domains, or client input. Look up the current role in the database on every admin request so role removal takes effect immediately. Require MFA on the admin's identity-provider account and a recent sign-in before a decision. Add app-level MFA if provider/account controls prove inadequate.
- Check authorization in every API operation and database query, including object ownership for private cases. Hide admin screens for convenience, but never rely on hiding them for access control. Log admin decisions and login/security events without logging secrets or full prompts unnecessarily.
- Validate inputs and model outputs with runtime schemas; render untrusted text safely; apply HTTPS and API security headers. Bound model context, request size, output tokens, spend, and execution time. Use the AI usage controls below; add bot controls only if abuse warrants them.
- Keep model and database secrets only on the API server; provider OAuth secrets belong in the managed auth configuration. The mobile bundle may contain only publishable configuration values. Provide `.env.example`, never commit real credentials, and scan dependencies/secrets in CI. Apply database least privilege and backups. Use parameterized ORM queries.
- Treat retrieved content and submitted questions as untrusted for prompt injection. The model gets no credentials or arbitrary network tools, and cannot approve challenges or modify source snapshots.

### AI usage and abuse controls

- Enforce limits **on the API before each OpenAI call**, including the interpretation call. Initial configurable defaults: anonymous visitors get 10 interpretations and 3 rulings per rolling 24 hours per IP; signed-in users get 30 interpretations and 10 rulings per rolling 24 hours per account, plus a short per-IP burst limit. These are starting values to tune from real usage, not promises of unlimited free access. A device-install ID may help diagnose abuse but is not a trusted identity because it can be reset.
- Atomically reserve a slot before a call so parallel requests cannot exceed the quota. Count a request once the provider call begins, even if the user cancels the screen. Return `429` with `Retry-After` and a clear in-app message when a personal limit is reached. Existing rulings and source links remain readable without AI usage.
- Set a project-wide daily OpenAI spend ceiling and a maximum number of simultaneous calls, with an emergency switch that stops new AI work. Atomically reserve a conservative cost allowance before each call, then reconcile it against provider-reported token usage; alert the maintainer before the ceiling is reached. When the ceiling is hit, return a helpful temporary-unavailable response instead of trying another paid model automatically.
- Limit question length, card count, retrieved excerpts, model output tokens, and clarification turns. Reuse a recent verified ruling for the same confirmed scenario and source snapshot where appropriate. Do not let the client supply a model name, system prompt, tools, or arbitrary retrieval URLs.
- Keep the app purpose narrow: the interpretation result must classify the question as Magic rules-related before the reasoning call. General chat, instructions to ignore the app's task, and unrelated requests receive no ruling. The model output must fit the ruling schema and cite retrieved rules/cards; a prompt-injection attempt cannot turn the API into a general chat endpoint.
- Store only short-lived counters keyed by account ID or a rotating keyed hash of IP, not raw IP addresses in the usage table. Test quota resets, concurrent requests, sign-in changes, off-topic prompts, and provider failures. An IP limit can affect shared networks, so provide a non-AI way to read existing rulings and an account quota for legitimate users.

## 8. Quality and contributor workflow

Configure ESLint with Expo/React Native and React Hooks rules for the app, Node/server rules for the API, `typescript-eslint` recommended type-checked rules for both, import ordering/cycle checks, unused import detection, and targeted security rules. Enforce no explicit `any`, no floating promises, safe handling of async calls, exhaustive `switch`, no unsafe type assertions at boundaries, and no disabled lint rules without a reason. Keep generated files and imported datasets out of linting. Avoid overlapping ESLint formatting rules and needless stylistic rules: **Prettier owns formatting**.

Set Prettier as a single repository format configuration for TypeScript, JSON, Markdown, and styles. Document commands such as `lint`, `lint:fix`, `format`, `format:check`, `typecheck`, `test`, and `build`. CI must run format check, lint, typecheck, focused unit/integration tests, API build, Expo export/config validation, dependency audit, and secret scanning. Build Android and iOS development binaries with EAS for device checks and release candidates; do not require full native builds on every small PR. Pin the package manager with a lockfile; use automated dependency update PRs. Require a passing CI run and one review for changes to auth, source import, prompts, and admin actions.

Test what can fail meaningfully:

- Unit: rules parser, card name/face resolution and repeated mentions, scenario and answer schema validation, citation verification, authorization decisions.
- Integration: import rollback, ruling persistence, challenge state transitions, ownership and admin route protection, atomic AI quotas and global cutoff.
- Evaluation: a reviewed set of representative interactions and hard cases, including missing facts and obsolete Oracle text. Assert source/citation correctness and expected outcome category, then human-review exact wording changes.
- End to end on Android and iOS development builds: mention cards → inspect one image per card → correct a wrong match → confirm → answer → challenge → admin decision → corrected answer, plus an unauthorized admin attempt. Cover missing images, double-faced cards, OAuth return links, and app resume after session expiry.

Add `README.md` (purpose, local setup, source credits, unofficial notice), `CONTRIBUTING.md` (architecture map, commands, PR checklist, adding a regression case), `SECURITY.md` (private vulnerability reporting), and a short decision log for changes to data sources, auth, and model behavior. Keep code comments for non-obvious rules logic; explain product behavior in tests and docs.

## 9. Delivery sequence and exit criteria

| Phase                     | Build                                                                                                                                                                                                                           | Done when                                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0. Foundation             | Expo app and API scaffolds, shared schemas, docs, strict TypeScript, ESLint, Prettier, CI, environment examples, database and migrations                                                                                        | A new contributor can run the API and app locally, open the app on Android/iOS, and pass all checks.                                                                                 |
| 1. Evidence               | Rules parser/import, cards bulk import, scheduled change check, snapshot metadata, indexed search, citation links                                                                                                               | A CLI can import/reimport safely, find exact cards and numbered rules, and activate an update without an app release.                                                                |
| 2. Rulings                | Native question screen, card-mention highlighting and image confirmation, scenario extraction, retrieval, model adapter, verified answer rendering, uncertainty/clarification handling, per-user/IP quotas and global AI cutoff | Users can correct card matches before ruling on Android and iOS; cited answers pass the seed set, invalid citations are blocked, and quotas prevent excess calls.                    |
| 3. Community review       | Google/Apple/GitHub sign-in, challenge submission, in-app admin queue, audit events, corrected ruling versions                                                                                                                  | No local passwords or app-copied provider tokens; only the correct user/admin can access each action; the full challenge flow works on both platforms.                               |
| 4. Improvement and launch | Reviewed evaluation set, source refresh schedule, monitoring, backups, abuse controls, attribution and policy review, public browser reading view, EAS builds                                                                   | Import freshness and failures are visible; regression gate passes; the app is free and marked unofficial; installable Android/iOS builds and a no-download public reading path work. |

Ship phases 0–3 in small PRs. Keep a short backlog after each phase based on observed errors, rather than adding infrastructure in anticipation of scale.

The PR-sized checklist, dependencies, and completion checks are in [TASKS.md](TASKS.md).

## 10. Open decisions before implementation

1. Use OpenAI `gpt-6-luna` through the Responses API for the MVP. Verify account access and data-retention settings during setup, set basic usage caps, and measure cost per answer; decide on a longer-term budget after MVP usage is visible. Revisit on-device inference only after the MVP, using real-device tests for ruling quality, latency, memory, and download size.
2. Configure and verify Google, Apple, and GitHub OAuth applications, Supabase callbacks, and Android/iOS deep links for development and production builds. Decide whether to support explicit linking of multiple social identities after launch; never infer that two provider accounts belong to the same person merely because their emails match.
3. Decide whether questions are public by default or only accessible by an unlisted link. Provide a no-download browser path to public rulings while keeping the primary experience in the Expo app.
4. Set a source-staleness threshold and import schedule after observing actual rules/card update cadence.

## Source references

- [Wizards Comprehensive Rules and official card database links](https://magic.wizards.com/en/rules)
- [Wizards Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy)
- [Scryfall API traffic and bulk-data guidance](https://scryfall.com/docs/faqs/i-m-having-trouble-accessing-the-scryfall-api-or-i-m-blocked-17)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [Expo Router for Android and iOS](https://docs.expo.dev/router/introduction/)
- [Supabase social auth with Expo](https://supabase.com/docs/guides/auth/quickstarts/with-expo-react-native-social-auth)
- [Supabase social providers](https://supabase.com/docs/guides/auth/social-login)
- [Supabase JWT verification](https://supabase.com/docs/guides/auth/jwts)
- [Expo EAS builds](https://docs.expo.dev/build/setup/)
- [OpenAI GPT-6 Luna model](https://developers.openai.com/api/docs/models/gpt-6-luna)
