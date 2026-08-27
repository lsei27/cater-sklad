FROM node:24-alpine AS base

# Install pnpm and dependencies
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Copy workspace config
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./

# Copy packages config
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

# Build shared package
RUN pnpm --filter @cater-sklad/shared build

# Generate Prisma Client
# prisma.config.ts vyzaduje DATABASE_URL uz pri nacteni konfigurace, ale samotne
# "generate" se k databazi nepripojuje. Podstrcime proto placeholder jen pro tenhle
# krok - build tim nezavisi na zadnem tajemstvi. Skutecnou adresu dodava Render
# az za behu pro "migrate deploy" a pro server.
WORKDIR /app/apps/api
RUN DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build" npx prisma generate

# Build API
RUN pnpm build

# Expose port
EXPOSE 3001

# Start command (migrations + server)
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
