# syntax=docker/dockerfile:1.7
# ---- Automation worker — official Playwright image (Chromium + system deps), pinned to the npm version ----
FROM mcr.microsoft.com/playwright:v1.49.1-noble AS build
WORKDIR /app
COPY apps/api/package.json apps/api/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY apps/api/tsconfig.json ./
COPY apps/api/src ./src
RUN npm run build && npm prune --omit=dev

FROM mcr.microsoft.com/playwright:v1.49.1-noble
WORKDIR /app
ENV NODE_ENV=production SERVICE_NAME=formagent-worker
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY apps/api/package.json ./
# Playwright image ships user pwuser (uid 1001)
USER pwuser
CMD ["node", "dist/worker-main.js"]
