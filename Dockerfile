FROM node:24-bookworm

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

RUN npm ci

COPY . .

EXPOSE 3000

CMD ["node", "src/index.js"]
