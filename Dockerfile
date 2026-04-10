# syntax=docker/dockerfile:1.4
# Multi-stage: build then run (smaller final image, no npm cache)
# Debian slim (glibc): @xenova/transformers → onnxruntime-node requires glibc;
# node:*-alpine (musl) fails with "ld-linux-aarch64.so.1: No such file or directory".
# Stage 1: install production dependencies
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund

# Stage 2: production runtime
FROM node:20-slim
WORKDIR /app

ENV NODE_ENV=production

# Copy production dependencies from deps stage (no devDependencies, no npm cache)
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./

# Copy application code (node_modules excluded via .dockerignore)
COPY . .

EXPOSE 7779
CMD ["npm", "start"]
