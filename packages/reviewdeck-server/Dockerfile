FROM node:22 AS build

WORKDIR /app

COPY package.json package-lock.json .npmrc tsconfig.json ./
COPY packages/reviewdeck-server/package.json packages/reviewdeck-server/
COPY packages/reviewdeck-ui/package.json packages/reviewdeck-ui/
RUN mkdir -p packages/reviewdeck && echo '{"name":"reviewdeck","version":"0.0.0"}' > packages/reviewdeck/package.json
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm config set registry $NPM_REGISTRY && npm ci

COPY src/ src/
COPY packages/reviewdeck-ui/src/ packages/reviewdeck-ui/src/
COPY packages/reviewdeck-ui/vite.config.ts packages/reviewdeck-ui/
COPY packages/reviewdeck-ui/tsconfig.json packages/reviewdeck-ui/
COPY packages/reviewdeck-server/src/ packages/reviewdeck-server/src/

RUN npm run build -w reviewdeck-ui && npm run build:web && npm run build -w reviewdeck-server

# --- Runtime ---
FROM node:22-slim

WORKDIR /app

ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm config set registry $NPM_REGISTRY && \
    npm init -y > /dev/null && \
    npm install --omit=dev @modelcontextprotocol/sdk postgres > /dev/null 2>&1 && \
    rm -rf /root/.npm

COPY --from=build /app/packages/reviewdeck-server/dist/ dist/
COPY --from=build /app/packages/reviewdeck-server/src/PROMPT.md PROMPT.md

ENV PORT=3847
EXPOSE 3847

CMD ["node", "dist/reviewdeck-server.mjs"]
