# Oasis Deployment Guide

Oasis runs as a Node.js server with SQLite. It can be deployed anywhere that runs Docker or Node 20+.

## Quick Start (Docker)

```bash
docker build -t oasis .
docker run -p 3000:3000 \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e NODE_ENV=production \
  -v oasis_data:/data \
  oasis
```

The Dockerfile builds a Node 20 Alpine image and uses `/data` as the persistent volume.

## Environment Variables

Required:
- `JWT_SECRET` — used for signing auth tokens (generate with `openssl rand -hex 32`)

Optional:
- `RESEND_API_KEY` — for transactional email (invite codes, etc.)
- `MAINTENANCE_MODE=true` — returns 503 on all routes
- `BACKUP_DISABLED=true` — skip automatic SQLite backups

## Persistent Data

All persistent state lives in `/data` (set via env vars in the Dockerfile):
- `DB_PATH=/data/oasis.db` — SQLite database
- `AVATARS_DIR=/data/avatars` — user avatar uploads
- `ATTACHMENTS_DIR=/data/attachments` — petition attachments
- `BACKUPS_DIR=/data/backups` — daily SQLite backups (auto-rotated)

## Running Without Docker

```bash
npm install
cp .env.example .env   # edit with your values
npm run seed            # create initial data
npm start               # or: npm run dev (with auto-reload)
```

## Production Checklist

- [ ] `JWT_SECRET` is set and strong
- [ ] Test accounts from seed data are removed or passwords changed
- [ ] HTTPS is configured (via reverse proxy or hosting platform)
- [ ] Backups are running (check logs for `[backup]` entries)
