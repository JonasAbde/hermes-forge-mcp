# Forge MCP Server — Dockerfile
# Multi-stage: TypeScript compile → runtime with prod deps only.

FROM node:24-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:24-slim AS runner
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/build ./build

ENV MCP_HTTP_PORT=8641
ENV NODE_ENV=production

EXPOSE 8641
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -qO- http://localhost:8641/health || exit 1

CMD ["node", "build/http-server.js"]
