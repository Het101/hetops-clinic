# Build stage: production dependencies only.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Runtime stage.
FROM node:22-slim
ARG APP_VERSION=dev
ARG READINESS_ALWAYS_FAIL=false
ENV NODE_ENV=production \
    APP_VERSION=$APP_VERSION \
    READINESS_ALWAYS_FAIL=$READINESS_ALWAYS_FAIL \
    PORT=8080
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY api/src ./api/src
COPY api/migrations ./api/migrations
# Numeric UID so Kubernetes can verify runAsNonRoot (the node image's "node" user is 1000).
USER 1000
EXPOSE 8080
CMD ["node", "api/src/server.js"]
