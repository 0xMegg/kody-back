# syntax=docker/dockerfile:1

# KODY OMS backend production image for AWS App Runner.
# Migrations intentionally do not run in this image or on container startup.

FROM node:22-bookworm-slim AS build
WORKDIR /app

# OpenSSL is required before `prisma generate` so the generated client targets
# the same Linux/OpenSSL runtime as the final image.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Keep build-time NODE_ENV unrestricted so devDependencies such as TypeScript and
# Prisma CLI are installed by npm ci.
COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate --schema prisma/schema.prisma

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Remove devDependencies after build while preserving the generated Prisma client.
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4000

# OpenSSL and CA certificates are required by Prisma's query engine and TLS DB connections.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma

USER node
EXPOSE 4000

CMD ["node", "dist/server/index.js"]
