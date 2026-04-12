FROM --platform=linux/amd64 node:22 AS build

WORKDIR /app

COPY package.json package-lock.json ./
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm config set registry $NPM_REGISTRY && npm ci

COPY src/ src/
COPY skills/ skills/
RUN npm run build

# --- Runtime ---
FROM --platform=linux/amd64 node:22-slim

WORKDIR /app

ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm config set registry $NPM_REGISTRY && \
    npm init -y > /dev/null && \
    npm install --omit=dev @hono/mcp @hono/node-server @modelcontextprotocol/sdk hono jose postgres zod > /dev/null 2>&1 && \
    rm -rf /root/.npm

COPY --from=build /app/dist/ dist/

ENV PORT=3847
EXPOSE 3847

ENTRYPOINT ["node", "dist/reviewdeck.mjs"]
CMD ["serve"]
