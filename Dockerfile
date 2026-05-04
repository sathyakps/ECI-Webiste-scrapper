# Node + preinstalled Chromium (matches package.json playwright@1.42.1).
# Use for Render, Fly.io, Railway, Koyeb, etc.
FROM mcr.microsoft.com/playwright:v1.42.1-jammy

WORKDIR /app
ENV NODE_ENV=production
# Image already ships browsers under /ms-playwright; skip redundant download.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY lib ./lib
COPY public ./public

EXPOSE 3000
ENV PORT=3000

CMD ["node", "server.js"]
