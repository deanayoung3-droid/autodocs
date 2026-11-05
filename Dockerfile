# AutoDocs for Cloud Run (or any container host): the Next.js server, its background worker,
# and a headless Chromium for screenshots. Debian-based, because Chromium needs glibc.
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    DATA_DIR=/data
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Chromium's headless shell, with its system libraries and fonts, installed by the app's own copy
# of Playwright so the versions always match. (npx would find that copy but not its command, since
# the standalone build has no node_modules/.bin.)
RUN node node_modules/playwright-core/cli.js install --with-deps --only-shell chromium \
 && rm -rf /root/.npm /var/lib/apt/lists/*
RUN groupadd -r app && useradd -r -g app -m app && mkdir -p /data && chown -R app:app /app /data
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
