# Stage 1: Build Vite React + Three.js frontend
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ENV NODE_OPTIONS="--max-old-space-size=2048"
RUN npm run build

# Stage 2: Lightweight Node.js HTTP + WebSocket production runtime
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server.mjs ./server.mjs
COPY --from=builder /app/server ./server
COPY --from=builder /app/circuits ./circuits
COPY --from=builder /app/public/maps ./public/maps
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/ws ./node_modules/ws

EXPOSE 3000

CMD ["node", "server.mjs"]
