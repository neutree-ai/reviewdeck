FROM node:22 AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/reviewdeck-server/package.json packages/reviewdeck-server/
RUN mkdir -p packages/reviewdeck && echo '{"name":"reviewdeck","version":"0.0.0"}' > packages/reviewdeck/package.json
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm config set registry $NPM_REGISTRY && npm ci

COPY src/ src/
COPY packages/reviewdeck-server/src/ packages/reviewdeck-server/src/

RUN npm run build:web && npm run build -w packages/reviewdeck-server

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
