# syntax=docker/dockerfile:1.7

FROM node:24-slim AS base
ENV PNPM_HOME=/usr/local/share/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
RUN corepack enable pnpm && apt-get update && apt-get install -y git openssh-client && rm -rf /var/lib/apt/lists/*

FROM base AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.pnpm-store \
    pnpm install --frozen-lockfile --ignore-scripts

COPY . .
RUN chmod +x scripts/docker-entrypoint.sh
# verify-deps-before-run is off because the install above ran with
# --ignore-scripts, which pnpm reads back as "these dependencies are not
# finished" and answers by running `pnpm install` again before the script. That
# second install runs the root `prepare` hook, `lefthook install`, which needs a
# git repository — and .git is deliberately not in the build context. The result
# was `fatal: not a git repository` failing the image build outright. Nothing is
# skipped by turning the check off here: the install it wants to repeat is the
# one on the line above.
RUN --mount=type=cache,id=pnpm-store,target=/root/.pnpm-store \
    pnpm --config.verify-deps-before-run=false build \
    && pnpm prune --prod --ignore-scripts

FROM base AS runner
WORKDIR /app
ENV LANTERN_ENV=production \
    PORT=3400 \
    LANTERN_HOSTNAME=0.0.0.0 \
    PATH="/app/node_modules/.bin:${PATH}"
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
COPY package.json pnpm-lock.yaml ./
EXPOSE 3400
ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
