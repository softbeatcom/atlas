FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:22-alpine

RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

ENV NODE_ENV=production \
    VITE_API_URL=http://localhost:8000/api/v1 \
    VITE_KEYCLOAK_URL=http://localhost:8080 \
    VITE_KEYCLOAK_REALM=atlas \
    VITE_KEYCLOAK_CLIENT_ID=atlas-web

WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./public
COPY --chown=node:node server.mjs ./server.mjs

USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"
CMD ["node", "server.mjs"]
