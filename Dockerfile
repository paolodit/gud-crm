ARG NODE_VERSION=24.18.0
FROM node:${NODE_VERSION}-alpine AS base
WORKDIR /app

FROM base AS deps
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ARG GUD_RELEASE_GUARDED=false
RUN if [ "$GUD_RELEASE_GUARDED" = "true" ]; then npm run lint && npm test && npm run test:release; fi
RUN npm run build
RUN npm run build:runtime-tools

FROM base AS runner
ARG GUD_BUILD_REVISION=local
ARG GUD_RELEASE_GUARDED=false
ENV GUD_BUILD_REVISION=${GUD_BUILD_REVISION}
ENV GUD_RELEASE_GUARDED=${GUD_RELEASE_GUARDED}
LABEL org.opencontainers.image.revision=${GUD_BUILD_REVISION}
LABEL com.gud.guarded-release=${GUD_RELEASE_GUARDED}
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache libstdc++
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
RUN mkdir -p /app/uploads && chown nextjs:nodejs /app/uploads
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 CMD ["node", "container-healthcheck.mjs"]
CMD ["node", "production-entrypoint.mjs"]
