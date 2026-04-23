FROM docker:28-cli AS docker-cli

FROM node:20-bookworm-slim AS base

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker

FROM base AS deps

COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p data logs storage
ENV DATABASE_URL=file:../data/stackpress.db
RUN npx prisma generate
RUN npx prisma db push --skip-generate
RUN npm run build

FROM base AS runner

ENV NODE_ENV=production

COPY --from=builder /app ./
COPY --from=builder /app/data/stackpress.db /opt/stackpress-seed/stackpress.db
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "run", "start"]
