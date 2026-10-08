FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN corepack enable
FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
FROM dependencies AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build
FROM base AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN groupadd --system --gid 1001 iz && useradd --system --uid 1001 --gid iz iz
COPY --from=build --chown=iz:iz /app/.next/standalone ./
COPY --from=build --chown=iz:iz /app/.next/static ./.next/static
USER iz
EXPOSE 3000
CMD ["node","server.js"]
FROM dependencies AS worker
COPY . .
ENV NODE_ENV=production
CMD ["pnpm","worker"]
