# GitHub Repository

The Oasis source code is hosted on GitHub.

## Clone

```bash
git clone https://github.com/YOUR_USERNAME/oasis.git
cd oasis
npm install
```

## Files Excluded via .gitignore

- `node_modules/` — reinstall with `npm install`
- `*.db`, `*.sqlite` — regenerate with `npm run seed`
- `.env` — set per environment
- `/data/` — persistent volume data (avatars, backups)
