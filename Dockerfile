# Multi-stage: build then run (smaller final image, no npm cache)
# Stage 1: install production dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Stage 2: production runtime
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production

# Copy production dependencies from deps stage (no devDependencies, no npm cache)
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./

# Copy application code (node_modules excluded via .dockerignore)
COPY . .

EXPOSE 7779
CMD ["npm", "start"]
