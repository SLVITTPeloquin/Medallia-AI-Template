FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV RUNTIME_DIR=/app/.runtime
ENV MS_GRAPH_TOKEN_CACHE_PATH=/app/.runtime/.graph-token-cache.json

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
COPY docs ./docs

RUN mkdir -p /app/.runtime

EXPOSE 3000

CMD ["node", "src/index.js"]
