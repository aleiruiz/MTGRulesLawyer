# API image. Build from the repository root: docker build -f apps/api/Dockerfile .
FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# A shared Corepack home so the unprivileged runtime user finds pnpm without downloading it.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 COREPACK_HOME=/opt/corepack
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate && chmod -R a+rX /opt/corepack
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/
COPY packages/contracts/package.json packages/contracts/
# Root tools (Prisma CLI, tsx) stay installed so migrations and the maintenance scripts run in this image.
RUN pnpm install --frozen-lockfile --filter mtg-rules-lawyer --filter "@mtg-rules/api..."

COPY prisma prisma
COPY prisma.config.ts ./
COPY packages/contracts packages/contracts
COPY apps/api apps/api
COPY scripts scripts
COPY deploy deploy
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm db:generate \
  && pnpm --filter @mtg-rules/contracts build \
  && pnpm --filter @mtg-rules/api build

USER node
ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "pnpm db:migrate && exec node apps/api/dist/server.js"]
