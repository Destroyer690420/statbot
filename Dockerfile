# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
COPY prisma/ ./prisma/
COPY prisma.config.ts ./
RUN npx prisma generate
RUN npm run build

# Production stage
FROM node:20-alpine
WORKDIR /app
# System Chromium for the GoPartTime automation poller (playwright-core drives
# it via executablePath; ~170MB, keeps polling inside the free-tier box).
# Xvfb lets the poller run headFUL (real-desktop signals for bot management).
# ffmpeg re-encodes task videos that are over Discord's 25 MB upload limit;
# without it an oversized video fails the whole assignment with a 413.
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont xvfb unzip ffmpeg
ENV PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium-browser
ENV DISPLAY=:99
ENV POLLER_HEADFUL=1
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
COPY package*.json ./
RUN npm ci --production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/generated/prisma ./src/generated/prisma
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./
RUN mkdir -p logs

EXPOSE 3000

CMD ["./docker-entrypoint.sh"]
