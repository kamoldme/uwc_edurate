# Oasis Deployment Guide

Your Oasis application is ready for production! Choose your deployment platform below.

## 🚀 Prerequisites

Before deploying, you need:
1. Your code pushed to GitHub (✅ Already done!)
2. A deployment platform account (Heroku, Vercel, etc.)
3. A domain name (optional - platforms provide free subdomains)

## Option 1: Heroku (Recommended - Easy & Free Tier)

### Step 1: Create Heroku Account
- Sign up at [https://heroku.com](https://heroku.com)
- Free tier includes 550-1000 dyno hours/month

### Step 2: Install Heroku CLI
```bash
# macOS
brew tap heroku/brew && brew install heroku

# Windows
# Download from https://devcenter.heroku.com/articles/heroku-cli

# Verify installation
heroku --version
```

### Step 3: Login to Heroku
```bash
heroku login
```

### Step 4: Create Heroku App
```bash
cd "/Users/kamold/Documents/claude code test/oasis"
heroku create oasis-app  # Change 'oasis-app' to your preferred name
```

### Step 5: Set Environment Variables
```bash
# Generate a secure JWT secret
heroku config:set JWT_SECRET=$(openssl rand -hex 32)

# Set Node environment
heroku config:set NODE_ENV=production
```

### Step 6: Deploy
```bash
git push heroku main
```

### Step 7: Open Your App
```bash
heroku open
```

Your app will be live at: `https://oasis-app.herokuapp.com`

### Step 8: Add Custom Domain (Optional)
```bash
heroku domains:add www.yourdomain.com
# Follow DNS configuration instructions
```

---

## Option 2: Vercel (Fast & Free)

### Step 1: Install Vercel CLI
```bash
npm i -g vercel
```

### Step 2: Deploy
```bash
cd "/Users/kamold/Documents/claude code test/oasis"
vercel
```

Follow the prompts:
- Set up and deploy? **Y**
- Which scope? Select your account
- Link to existing project? **N**
- Project name? **oasis**
- Directory? **./  (just press Enter)**
- Override settings? **N**

### Step 3: Set Environment Variables
```bash
vercel env add JWT_SECRET
# Paste your secret (generate with: openssl rand -hex 32)
```

### Step 4: Deploy to Production
```bash
vercel --prod
```

Your app will be live at: `https://oasis.vercel.app`

---

## Option 3: DigitalOcean/VPS ($5-10/month)

### Step 1: Create a Droplet
1. Sign up at [DigitalOcean](https://digitalocean.com)
2. Create a new Droplet (Ubuntu 22.04)
3. Choose $5/month plan
4. Add your SSH key

### Step 2: SSH into Server
```bash
ssh root@your-server-ip
```

### Step 3: Install Node.js
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs
```

### Step 4: Install PM2 (Process Manager)
```bash
npm install -g pm2
```

### Step 5: Clone Your Repository
```bash
git clone https://github.com/kamoldme/oasis.git
cd oasis
npm install
```

### Step 6: Set Environment Variables
```bash
nano .env
```

Add:
```
PORT=3000
NODE_ENV=production
JWT_SECRET=your-generated-secret-here
```

### Step 7: Start Application
```bash
pm2 start server.js --name oasis
pm2 save
pm2 startup
```

### Step 8: Configure Nginx (Reverse Proxy)
```bash
apt-get install -y nginx

nano /etc/nginx/sites-available/oasis
```

Add:
```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable site:
```bash
ln -s /etc/nginx/sites-available/oasis /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

### Step 9: Add SSL (HTTPS) with Let's Encrypt
```bash
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

---

## Option 4: Railway (Modern & Easy)

1. Visit [railway.app](https://railway.app)
2. Sign in with GitHub
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your `oasis` repository
5. Add environment variable: `JWT_SECRET`
6. Click "Deploy"

Your app will be live at: `https://oasis-production.up.railway.app`

---

## Option 5: Render (Free Tier Available)

1. Sign up at [render.com](https://render.com)
2. Click "New +" → "Web Service"
3. Connect your GitHub repository
4. Configure:
   - **Name**: oasis
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Add environment variables:
   - `JWT_SECRET`: (generate with `openssl rand -hex 32`)
   - `NODE_ENV`: production
6. Click "Create Web Service"

Your app will be live at: `https://oasis.onrender.com`

---

## 🔒 Production Security Checklist

Before going live:

- [ ] Change all default passwords in seed data
- [ ] Set strong JWT_SECRET (use `openssl rand -hex 32`)
- [ ] Enable HTTPS/SSL (automatic on most platforms)
- [ ] Set NODE_ENV=production
- [ ] Review and update CORS settings if needed
- [ ] Set up database backups
- [ ] Configure email for support system
- [ ] Test all features in production
- [ ] Set up monitoring (Sentry, LogRocket, etc.)

---

## 📊 Database Options

### SQLite (Default - Good for Small Scale)
- Already configured
- Works out of the box
- File-based database (`oasis.db`)
- Good for < 10,000 users

### PostgreSQL (Recommended for Production)
Install PostgreSQL adapter:
```bash
npm install pg
```

Update database configuration to use `DATABASE_URL` environment variable.

Heroku provides free PostgreSQL:
```bash
heroku addons:create heroku-postgresql:mini
```

---

## 🌐 Custom Domain Setup

### For Heroku:
```bash
heroku domains:add www.yourdomain.com
heroku domains:add yourdomain.com
```

Then add DNS records:
- **Type**: CNAME
- **Name**: www
- **Value**: your-app.herokuapp.com

### For Vercel:
1. Go to Vercel Dashboard → Your Project → Settings → Domains
2. Add your domain
3. Configure DNS as instructed

---

## 📧 Post-Deployment Configuration

### 1. Update Support Email
Edit frontend to show your support email instead of placeholder.

### 2. Test Accounts
**IMPORTANT**: Delete or change passwords for test accounts:
```sql
-- Login to your database and run:
DELETE FROM users WHERE email LIKE '%@oasis.uwcdilijan.am';
```

### 3. Create First Admin
Access your app and register first real admin account.

---

## 🆘 Troubleshooting

### "Application Error" on Heroku
```bash
heroku logs --tail
```

### Port Issues
Make sure your app uses `process.env.PORT`:
```javascript
const PORT = process.env.PORT || 3000;
```
✅ Already configured in server.js

### Database Connection Issues
- Verify DATABASE_URL is set
- Check database credentials
- Ensure database server is running

---

## 🎉 You're Live!

Once deployed, share your app:
- **URL**: `https://your-app.herokuapp.com` (or your custom domain)
- **Admin Login**: Create new admin after removing test accounts
- **Monitor**: Check logs and analytics

---

## 📞 Need Help?

- **Heroku Docs**: https://devcenter.heroku.com
- **Vercel Docs**: https://vercel.com/docs
- **DigitalOcean Tutorials**: https://www.digitalocean.com/community/tutorials

---

**Your Oasis is production-ready! Choose a platform above and deploy in minutes.** 🚀
