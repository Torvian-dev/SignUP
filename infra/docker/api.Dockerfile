# syntax=docker/dockerfile:1.7
# ---- API (Express) — small, non-root, no browser ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY apps/api/package.json apps/api/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci

FROM deps AS build
COPY apps/api/tsconfig.json ./
COPY apps/api/src ./src
RUN npm run build && npm prune --omit=dev

FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runtime
WORKDIR /app
ENV NODE_ENV=production SERVICE_NAME=formagent-api
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY apps/api/package.json ./
EXPOSE 4000
USER nonroot
CMD ["dist/index.js"]
