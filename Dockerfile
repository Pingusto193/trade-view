# syntax=docker/dockerfile:1
# Radar — imagem de produção (Fase 8). Um único processo Node serve a API, o WebSocket e o PWA.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable
WORKDIR /app

# ---- dependências (o better-sqlite3 já traz binários prontos para Linux x64/ARM: nada a compilar)
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/data/package.json packages/data/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

# ---- build do PWA
FROM deps AS build
COPY . .
RUN pnpm --filter @radar/web build

# ---- execução
FROM base AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATABASE_PATH=/data/radar.sqlite \
    WEB_DIST=/app/apps/web/dist
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
WORKDIR /app/apps/server
CMD ["./node_modules/.bin/tsx", "src/index.ts"]
