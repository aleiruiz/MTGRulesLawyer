#!/bin/sh
# Daily source refresh and alerts, run on the server inside the API container.
# Runs every step even when one fails, and exits non-zero if any did so the scheduler reports it.
status=0
pnpm sources:refresh || status=1
# Imports Spanish card names at most once a week unless called with --force.
pnpm cards:localized-names || status=1
pnpm sources:check || status=1
pnpm ops:ai-usage || status=1
exit "$status"
