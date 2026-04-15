FROM node:22-slim

RUN apt-get update && \
    apt-get install -y curl git chromium fonts-liberation ca-certificates --no-install-recommends && \
    rm -rf /var/lib/apt/lists/* && \
    npm install -g @anthropic-ai/claude-code puppeteer

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app
COPY server.mjs build-site.mjs scrape-site.mjs /app/

EXPOSE 8080
CMD ["node", "/app/server.mjs"]
