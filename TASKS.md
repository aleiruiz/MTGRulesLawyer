# MTG Rules Lawyer — MVP task backlog

This is the implementation checklist for the [development plan](DEVELOPMENT_PLAN.md). Each checkbox is intended to fit in one reviewable pull request. IDs are stable so issues and PRs can refer to them. Dependencies are listed in parentheses; tasks in the same milestone can run independently when their dependencies are met.

**MVP cut line:** Complete F01–F05, D01–D06, R01–R09, C01–C06, and L01–L06. The post-MVP list is optional. The first playable slice is F01–F05 → D02/D03/D05 → R01–R07; authentication and community review follow once rulings work end to end.

## Foundation

- [x] **F01 — Scaffold the repository.** Create the Expo Router app (`apps/mobile`), Fastify API (`apps/api`), shared schema package (`packages/contracts`), package-manager workspace, lockfile, and starter scripts. **Done:** both processes start locally and the app can call a health endpoint.
- [x] **F02 — Set code quality defaults** (F01). Enable strict TypeScript, separate Expo/React Native and Node ESLint configs with type-aware rules, Prettier, and documented `lint`, `format:check`, `typecheck`, `test`, and `build` commands. **Done:** every command passes on the starter repo and an intentional lint/type error fails CI locally.
- [x] **F03 — Add CI and repository hygiene** (F02). Run formatting, lint, typecheck, tests, API build, Expo export/config checks, dependency audit, and secret scanning on PRs. Add `.gitignore`, `.env.example`, and dependency update configuration. **Done:** a clean PR passes and a bad formatting or secret fixture is caught.
- [x] **F04 — Document contributor setup** (F01–F03). Write `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, and an architecture map with local API/app/database setup, source credits, and unofficial notice. **Done:** a contributor can start the project without private credentials or verbal guidance.
- [x] **F05 — Create the database foundation** (F01). Add Prisma schema and first migration for snapshots, rules, cards/faces, questions, confirmed cards, ruling versions/citations, app users, challenges, reviews, and usage windows. **Done:** migrate from an empty database and reset/reseed locally without manual SQL.

## Rules and card evidence

- [ ] **D01 — Confirm source and image use** (F04). Record the current Wizards Fan Content Policy and Scryfall data/image terms, attribution text, links, and any display limits in a short decision record. **Done:** contributors know what can be imported, shown, and linked before building the public UI.
- [ ] **D02 — Import Comprehensive Rules** (F05). Fetch the TXT from the official rules page, parse numbered rules and cross-references, and store source URL/date/checksum. **Done:** tests cover representative numbered rules and a malformed input cannot replace the active data.
- [ ] **D03 — Import Oracle cards** (F05). Consume the Scryfall Oracle Cards bulk file, including multi-face cards, Oracle IDs, text, names, and image references. **Done:** exact and alternate-face lookups work without calling Scryfall for each user request.
- [ ] **D04 — Make snapshot activation safe** (D02, D03). Import into a candidate snapshot, validate counts/schema, then atomically activate it; retain the previous version and its citation IDs. **Done:** a failed import leaves the last good snapshot active, and old rulings remain reconstructable.
- [ ] **D05 — Add local search and retrieval** (D02, D03). Index card names and rule text in PostgreSQL; implement exact card lookup, text search, rule cross-reference expansion, and bounded evidence assembly. **Done:** fixture questions retrieve the expected cards and rule sections with no third-party request.
- [ ] **D06 — Refresh sources automatically** (D04). Add a scheduled daily change check plus a manual refresh command, import logs, active snapshot metadata, and stale-source alert. **Done:** an unchanged source does no reimport, a changed source activates safely, and a failure is visible.

## Ruling experience and AI cost controls

- [ ] **R01 — Add the OpenAI model adapter** (F01, F02). Call the Responses API from the server with configurable `gpt-6-luna`, structured outputs, timeouts, bounded tokens, and prompt/model version logging. **Done:** a mocked response and one opt-in live smoke test produce validated typed output; the API key never enters the mobile bundle.
- [ ] **R02 — Enforce AI quotas before provider calls** (F05, R01). Add atomic usage reservations for interpretation and ruling calls, anonymous IP and signed-in account limits, a burst limit, a global daily cost reservation/ceiling, concurrency cap, and an emergency switch. **Done:** parallel requests cannot bypass limits; `429` includes `Retry-After`; a global cutoff makes no OpenAI call.
- [ ] **R03 — Interpret and scope a question** (D03, R01, R02). Build `POST /api/questions/interpret` returning schema-validated card candidates, mention spans, scenario facts, missing facts, and in-scope status. Resolve card identity in code. **Done:** unrelated prompts stop before ruling generation; ambiguous card names return choices rather than guesses.
- [ ] **R04 — Build the native card confirmation screen** (R03, D01). Highlight mentions and show one swipeable card tile per distinct card with image, text fallback, face switch, count, and replace/remove/add controls. **Done:** Android and iOS users can correct every match and confirm Oracle IDs before asking for a ruling; screen readers can identify the controls.
- [ ] **R05 — Connect confirmed cards to retrieval** (R04, D05). Accept confirmed card IDs and game state, fetch bounded relevant evidence, and record snapshot/source IDs. **Done:** client-supplied image URLs or Oracle text cannot influence the evidence, and the retrieved packet can be inspected in tests.
- [ ] **R06 — Generate and verify rulings** (R01, R02, R05). Produce a structured outcome and reasoning steps; verify every cited card/rule against the snapshot and fall back to `uncertain` on unsupported claims. **Done:** invalid citations never appear as valid answers and missing decisive facts produce a clarification.
- [ ] **R07 — Present and persist answers** (R06). Build the ruling screen, card row, assumptions, numbered-rule citations, snapshot date, shareable ruling ID, and edit/rerun flow. **Done:** a user can read a complete answer, inspect evidence, and distinguish `resolved`, `conditional`, `needs_information`, and `uncertain` outcomes.
- [ ] **R08 — Create a reviewed evaluation seed set** (R06). Add representative card interactions and hard cases (layers, replacement effects, triggers, multiplayer, and missing facts) with expected outcome category and citations. **Done:** model/prompt changes run a repeatable evaluation and any failure is reviewable.
- [ ] **R09 — Reduce repeat cost and test abuse paths** (R07, R08). Reuse recent verified results for the same confirmed scenario and snapshot, record token/cost metrics, and test quota reset, cancellation, prompt injection, off-topic prompts, and provider errors. **Done:** repeated identical requests avoid an unnecessary model call, and abuse tests pass.

## Sign-in and community correction

- [ ] **C01 — Set up managed social auth** (F05). Configure Supabase Auth for Google, Apple, and GitHub, plus Android/iOS deep links and secure session storage. **Done:** all three providers sign in and return to a development build on real devices; no app-managed password or copied profile data is stored.
- [ ] **C02 — Protect the API and admin role** (C01). Verify Supabase access tokens server-side, link to an `AppUser` ID, enforce ownership, and check admin role from the database on every admin operation. **Done:** forged/expired tokens and non-admin requests are denied; removing a role takes effect immediately.
- [ ] **C03 — Submit and track challenges** (C02, R07). Add the signed-in challenge form, explanation/proposed result, `POST /api/rulings/:id/challenges`, and a user's own status list. **Done:** users can view only their private cases; duplicate submissions and spam are limited.
- [ ] **C04 — Build the in-app review queue** (C02, C03). Show the original answer, evidence snapshot, challenge, and review status; allow admins to request more information. **Done:** an admin can triage the queue on Android and iOS, and non-admins cannot load it through the API.
- [ ] **C05 — Record decisions and corrected versions** (C04). Implement approve/reject with a required reason, immutable `ReviewEvent`, linked corrected ruling, and atomic status transition. **Done:** simultaneous decisions cannot conflict; the original ruling remains viewable and the challenger sees the outcome.
- [ ] **C06 — Feed approved cases into evaluation** (C05, R08). Export reviewed scenarios and error categories into versioned regression fixtures after a human checks them. **Done:** an approved challenge is represented in the evaluation set; rejected or unreviewed text never changes model behavior automatically.

## Release readiness

- [ ] **L01 — Exercise the full mobile journey** (R07, C05). Run Android and iOS end-to-end checks for question → card correction → ruling → challenge → review → corrected answer, including sign-in return, session expiry, missing images, and double-faced cards. **Done:** the journey passes on development builds on both platforms.
- [ ] **L02 — Add service health and recovery** (D06, R09). Monitor import freshness, API errors, model cost/latency, quota cutoff, and database backups; document restore steps. **Done:** a failed import or spending spike is visible and a database restore has been rehearsed.
- [ ] **L03 — Provide public browser reading access** (R07, D01). Add a small read-only public ruling page with evidence links and unofficial notice so fan content can be accessed without downloading the app. **Done:** a shared ruling URL works anonymously in a browser, including on a phone.
- [ ] **L04 — Final security and policy review** (C05, L02, L03). Check auth bypass, ID ownership, secrets, prompt injection, source attribution, provider terms, privacy/deletion flow, and API rate limits. **Done:** findings are fixed or tracked with explicit launch decisions.
- [ ] **L05 — Prepare Android and iOS release builds** (L01, L04). Configure EAS profiles, app IDs, icons, deep links, production environment values, and release notes. **Done:** installable release-candidate builds work on physical Android and iOS devices.
- [ ] **L06 — Pilot and evaluate** (L02–L05). Run a small user pilot, review incorrect rulings and cost per answer, and adjust limits/clarification behavior. **Done:** the seed evaluation passes, no launch-blocking security issue remains, and the maintainer accepts the measured per-answer cost.

## Later, only if the MVP proves the need

- [ ] **P01 — On-device inference experiment.** Compare a local model with Luna on reviewed cases and real Android/iOS devices for correctness, citations, latency, memory, and download size.
- [ ] **P02 — More retrieval sources.** Add official card-specific rulings or release notes if the error review shows that the Comprehensive Rules and Oracle text alone are insufficient.
- [ ] **P03 — Deeper game-state modeling.** Add a structured stack/turn-state editor or simulator only for interaction classes that repeatedly fail with the simpler form.

## Pull request checklist

Each PR should link its task ID, describe the user-visible behavior, note any schema/source/prompt version change, and show the relevant passing checks. For AI or rules changes, include the evaluation cases affected. For auth or admin changes, include a denied-access check. Update this checklist when a task is completed or split.
