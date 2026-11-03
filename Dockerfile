# Gfloge production image: api and worker share one image (ADR A5) and are
# selected by GF_ROLE at runtime. Migrations run in the entrypoint under an
# advisory lock, so api and worker can boot in any order.

# ---- build stage: compile the SPA ----
FROM node:22-slim AS build
WORKDIR /app
COPY . .
RUN npm ci --no-audit --no-fund
RUN npm run build

# ---- runtime stage ----
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps ./apps
RUN npm prune --omit=dev --no-audit --no-fund \
    && apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data && chown -R node:node /data

COPY docker/entrypoint.sh /usr/local/bin/gfloge-entrypoint
RUN chmod +x /usr/local/bin/gfloge-entrypoint

USER node
EXPOSE 8080
ENTRYPOINT ["gfloge-entrypoint"]
