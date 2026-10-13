# Web app image: the Expo web export served by Caddy. Build from the repository root:
# docker build -f apps/mobile/Dockerfile --build-arg EXPO_PUBLIC_API_URL=https://api.example .
FROM node:22-bookworm-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile --filter "@mtg-rules/mobile..."

COPY packages/contracts packages/contracts
COPY apps/mobile apps/mobile

# Public values only; they are compiled into the browser bundle.
ARG EXPO_PUBLIC_API_URL
ARG EXPO_PUBLIC_WEB_URL
ARG EXPO_PUBLIC_SUPABASE_URL
ARG EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
RUN test -n "$EXPO_PUBLIC_API_URL" || (echo "EXPO_PUBLIC_API_URL is required" && exit 1)
RUN pnpm --filter @mtg-rules/contracts build \
  && cd apps/mobile \
  && pnpm exec expo export --platform web --output-dir web-dist

FROM caddy:2-alpine
COPY apps/mobile/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/mobile/web-dist /srv
EXPOSE 80
