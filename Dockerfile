# Current Node 24 LTS patch, pinned by multi-arch index digest (amd64 + arm64).
# To bump: docker buildx imagetools inspect node:24-bookworm
FROM node:24.18.1-bookworm@sha256:19cd848a0e073d34bd8cd5545a1b6b4d28489b3e3b607366621ced442bd5f6b4

RUN apt-get update && apt-get install -y \
    ca-certificates \
    chromium \
    xvfb \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# chrome-launcher (used by puppeteer-real-browser) reads CHROME_PATH
ENV CHROME_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json .npmrc ./

RUN npm ci --omit=dev

COPY --chown=node:node . .

USER node

EXPOSE 3000

CMD ["node", "src/index.js"]
