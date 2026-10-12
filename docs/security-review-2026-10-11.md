# Security and policy review — 2026-10-11

This review records the launch-relevant findings from the MVP security and source-policy audit. It is an engineering checklist, not legal advice or a certification. No production deployment was reviewed.

## Reviewed controls

- Supabase access tokens are verified server-side through Supabase Auth before they identify an app user. Admin routes resolve the app role from PostgreSQL on each request; the client cannot supply a role.
- Private challenge listing is scoped to the authenticated app-user ID. Challenge creation and admin decisions validate request schemas and use database transactions; same-user challenge submissions are serialized for the daily limit.
- Model calls reserve account/IP quotas, global cost, and concurrency before contacting OpenAI. The app sends bounded scenario fields and retrieved evidence; the model has no tools or credentials. Unsupported citations fall back to an uncertain answer.
- Evaluation export requires player consent, an approved correction, explicit admin inclusion, and a strict admin-authored fixture. It excludes the original challenge text and identifiers.
- `.env.example` uses placeholders, provider secrets stay in Supabase configuration, and CI includes secret scanning and dependency auditing.
- Regression coverage exists for forged tokens, private ownership, non-admin access, prompt injection, quota enforcement, unsupported evidence, and evaluation consent/export.

## Changes made by this review

- Disabled Scryfall image rendering in the mobile card confirmation UI. The project’s source decision calls for text-only previews until current image guidance has been verified. Card names and text remain available for the rules workflow; no external image request is made by this screen.

## Launch blockers and decisions

| Finding                           | Decision before public launch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin identity security           | The development plan requires MFA and a recent sign-in for admin actions. The API currently checks the database role but does not enforce MFA assurance or recent authentication. Keep production admin access disabled until the API verifies an appropriate Supabase assurance level and freshness for every review action, with tests. **Follow-up L07:** the API now requires `aal2` and a check within `ADMIN_AUTH_MAX_AGE_SECONDS` for every `/api/admin` request; see [operations](operations.md#admin-access).             |
| Account privacy and deletion      | There is no account/question deletion endpoint or documented retention schedule. Questions, game-state details, challenges, and review history can contain user-submitted text; some rows are intentionally immutable and have restrictive foreign keys. Decide what users can delete, how immutable audit records are anonymized, and the retention period, then implement and test the flow before launch. **Follow-up L09:** the owner chose immediate deletion (2026-10-12); see [operations](operations.md#account-deletion). |
| OAuth setup and device return     | The social sign-in client uses placeholders and the repository has no provider credentials. Configure Google, Apple, and GitHub in Supabase and complete sign-in, cancellation, expiry, and return-link checks on Android and iOS development builds before marking C01 or L01 complete.                                                                                                                                                                                                                                           |
| Wizards material and product name | The current Wizards Fan Content Policy page still identifies itself as last updated November 15, 2017. It requires the unofficial notice and restricts Wizards trademarks. Obtain written guidance for serving Comprehensive Rules and Oracle text through the app, or change the release scope to avoid those uses; choose a non-trademark product name or obtain written permission before public branding.                                                                                                                      |
| Scryfall display terms            | The live Scryfall API and bulk-data guidance could not be directly verified during this review. Image rendering is disabled pending verification. Before launch, verify the current terms for imported data and card text/image references, retain attribution, and confirm the permitted display method.                                                                                                                                                                                                                          |
| Public data exposure              | Anonymous ruling reads are intentional, and return the question, answer, citations, and evidence excerpts. Keep the endpoint read-only and do not deploy it publicly until the Wizards source-use question above is resolved. Challenges and review records remain behind authenticated ownership/admin checks.                                                                                                                                                                                                                    |

## Evidence and references

- Authorization and ownership: `apps/api/src/auth/authorization.ts`, `apps/api/src/auth/supabase-auth.ts`, and `apps/api/src/auth/authorization.test.ts`.
- Abuse and evidence controls: `apps/api/src/ai/usage.ts`, `apps/api/src/rulings/generate.ts`, and their tests.
- Challenge/export controls: `apps/api/src/challenges/service.ts`, `apps/api/src/reviews/service.ts`, and `apps/api/src/reviews/service.integration.test.ts`.
- [Wizards Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy).
- [Scryfall API traffic and bulk-data guidance](https://scryfall.com/docs/faqs/i-m-having-trouble-accessing-the-scryfall-api-or-i-m-blocked-17).
- [Supabase JWT claims reference](https://supabase.com/docs/guides/auth/jwt-fields).
- [Supabase social login documentation](https://supabase.com/docs/guides/auth/social-login).

The policy links were checked on 2026-10-11. The Wizards page reports a 2017 update date. Scryfall’s traffic guidance was available, but its API and bulk-data documentation could not be directly verified; the display decision remains conservative until that review is completed.
