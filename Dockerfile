# ==============================================================================
# AutoReport AI - Production Dockerfile
# Compatible with Render, Railway, Fly.io, and Cloud VPS
# ==============================================================================

FROM node:20-bookworm-slim

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Install Chromium and fonts (Debian Bookworm automatically resolves all shared library dependencies)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    git \
    ca-certificates \
    fonts-liberation \
    fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Copy package manifests and install production dependencies
COPY package*.json ./
RUN npm install --omit=dev --no-audit

# Copy application source code
COPY . .

# Ensure data directory and session auth directory exist with non-root permissions
RUN mkdir -p data/users .wwebjs_auth && chown -R node:node /usr/src/app

# Switch to non-root user
USER node

# Expose server port
EXPOSE 3000

ENV PORT=3000 \
    NODE_ENV=production

CMD ["node", "index.js"]
