# Security policy

## Supported code

Security fixes are accepted for the current default branch. Keep dependencies updated through reviewed Dependabot pull requests and the repository's dependency audit gate.

## Report a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting for this repository when it is enabled. Include the affected commit or branch, steps to reproduce, impact, and any suggested mitigation. Avoid sending secrets or real user data in the report.

If private reporting is unavailable, contact the repository maintainer through the contact information on the maintainer's GitHub profile and request a private channel. The project will acknowledge reports and coordinate a fix before publicly disclosing details.

## Local secrets

Use `.env.example` as a placeholder template. Keep populated `.env` files and credentials out of Git. If a credential is committed, revoke or rotate it immediately; removing it in a later commit does not make it safe again.
