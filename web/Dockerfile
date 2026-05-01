# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps

WORKDIR /app

# Install web server dependencies only (no devDeps, no Electron)
COPY web/package.json ./web/package.json
RUN cd web && npm install --omit=dev

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

# Shared library logic from the repo (used by server.js via require('../assets/js/...'))
COPY assets/js/ ./assets/js/

# Locale catalogues used by the web i18n loader (/locales/*.json)
COPY renderer/locales/ ./renderer/locales/

# Web server
COPY web/server.js        ./web/server.js
COPY web/preferences.json ./web/preferences.json
COPY web/public/          ./web/public/

# Always use the freshest compiled Tailwind output from the renderer.
# This overrides whatever is committed in web/public/css/output.css so the
# Docker image is never stale even if the manual sync was forgotten.
COPY renderer/css/output.css ./web/public/css/output.css
COPY renderer/img/ ./web/public/img/

# Default (baked-in) sample library — overridable at runtime via volume mount
COPY web/library/         ./web/library/

# node_modules from build stage
COPY --from=deps /app/web/node_modules ./web/node_modules

# The library path used by the server.
# Override with: docker run -e LIBRARY_PATH=/library -v /host/songs:/library ...
ENV LIBRARY_PATH=/app/web/library
ENV PORT=3000

EXPOSE 3000

WORKDIR /app/web
CMD ["node", "server.js"]
