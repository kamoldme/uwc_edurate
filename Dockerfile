FROM node:20-alpine

# Build tools for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# SQLite DB lives on the persistent volume mounted at /data
ENV DB_PATH=/data/oasis.db
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "server.js"]
