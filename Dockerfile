#   docker build .
#
# bookworm-slim, as Engram's API is: every runtime dependency is pure
# JavaScript, and sharing the other tenants' base keeps musl out of the
# variables nobody is testing.
FROM node:24-bookworm-slim AS build
WORKDIR /repo
ENV PNPM_HOME=/pnpm CI=1
RUN corepack enable

# Manifests before source, so the install layer survives every change that is
# only code.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
  pnpm install --frozen-lockfile --store-dir /pnpm-store

COPY src src
RUN pnpm run build

# Production dependencies only, so the runtime image carries neither the
# compiler nor the test runner. Prefer-offline rather than offline: CI's layer
# cache restores the install above without its cache mount, so on a fresh
# runner the store can be empty here and has to be filled from the registry.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
  rm -rf node_modules && pnpm install --frozen-lockfile --prod --prefer-offline --store-dir /pnpm-store

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/package.json ./
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/dist dist
COPY drizzle drizzle

# Migrations run on boot, so a container that starts is one whose schema
# matches its code. Forward-only: rolling an image back past a destructive
# one needs a restore, not a tag change.
COPY --chmod=0755 <<'ENTRYPOINT' /app/entrypoint.sh
#!/bin/sh
set -e
node dist/db/migrate.js
exec node dist/server.js
ENTRYPOINT

USER node

# `/health` answers without Postgres, so a database blip does not restart a
# process that is otherwise fine.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||2013)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/entrypoint.sh"]
