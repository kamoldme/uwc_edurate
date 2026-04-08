FROM node:20-alpine

# Build tools for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# SQLite DB, uploaded avatars, and DB backups all live on the persistent
# volume mounted at /data so they survive container restarts and redeploys.
ENV DB_PATH=/data/oasis.db
ENV AVATARS_DIR=/data/avatars
ENV ATTACHMENTS_DIR=/data/attachments
ENV BACKUPS_DIR=/data/backups
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "server.js"]
