# ==============================================================================
# AutoReport AI - Production Dockerfile
# Compatible with Render, Railway, Fly.io, and VPS
# ==============================================================================

FROM node:20-bullseye-slim

# Install Chromium and system dependencies for puppeteer / whatsapp-web.js
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    chromium \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use installed Chromium binary instead of downloading bundled Chrome
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /usr/src/app

# Copy package manifests and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application source code
COPY . .

# Ensure data directory exists for persistent state and auth tokens
RUN mkdir -p data .wwebjs_auth && chown -R node:node /usr/src/app

# Switch to non-root user
USER node

# Web dashboard port
EXPOSE 3000

ENV PORT=3000 \
    NODE_ENV=production

CMD ["node", "index.js"]
