# Deployment Guide (Ubuntu VPS)

This guide assumes you have a fresh Ubuntu server.

## 1. Prerequisites (Run on Server)

Install Node.js (v20), Nginx, and PM2.

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install Nginx
sudo apt install -y nginx

# Install PM2 (Process Manager)
sudo npm install -g pm2
```

## 2. Setup Project

Pull your code to `/var/www/dnbcoaching` (or your preferred directory).

```bash
# Example
git clone <your-repo-url> /var/www/dnbcoaching
cd /var/www/dnbcoaching

# Install dependencies and build
npm install
npm run build
```

## 3. Configure Env

Create a `.env` file in the root directory:

```bash
nano .env
```

Add your secrets:
```env
PORT=3000
examples:
OPENAI_API_KEY=sk-...
ADMIN_PASSWORD=your_secure_password
```

## 4. Start Application (PM2)

```bash
# Start the server (which serves the API + Static Frontend)
pm2 start server/index.js --name "dnb-coach"

# Save configuration to restart on reboot
pm2 save
pm2 startup
```

## 5. Configure Nginx (Reverse Proxy)

Create a configuration file:

```bash
sudo nano /etc/nginx/sites-available/dnbcoaching
```

Paste the following (replace `yourdomain.com`):

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

Enable the site and restart Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/dnbcoaching /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## 6. SSL (HTTPS)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

---

## Local Development (Testing)

To test locally on your machine:

1.  **Install**: `npm install`
2.  **Start Backend**: `npm run start` (Starts server on port 3000)
    *   *Note*: The production server serves the built frontend from `dist/`.
    *   *Alternative*: For **hot-reloading**, run two terminals:
        1.  Start Backend: `node server/index.js`

## 7. Auto-Deploy (GitHub Actions)

I have set up a workflow that automatically updates your server whenever you push code to GitHub.

### Step 1: Generate SSH Key (On Your Machine)
If you don't have a deploy key yet, generate a new pair (do not add a passphrase for automation purposes):
```bash
ssh-keygen -t ed25519 -C "github-actions" -f ~/.ssh/github_actions
```

### Step 2: Add Public Key to Server
Copy the content of `~/.ssh/github_actions.pub` and add it to your server's authorized keys:
```bash
# On your server:
nano ~/.ssh/authorized_keys
# Paste the public key content on a new line, save and exit.
```

### Step 3: Add Secrets to GitHub
1. Go to your GitHub Repository -> **Settings**.
2. Go to **Secrets and variables** -> **Actions** -> **New repository secret**.
3. Add the following secrets:
    - `HOST`: Your server's IP address (e.g., `123.45.67.89`).
    - `USERNAME`: Your server username (e.g., `root` or `ubuntu`).
    - `KEY`: The **Private Key** (content of `~/.ssh/github_actions` from Step 1).

### Step 4: Test
Push a change to the `main` branch. Go to the **Actions** tab in GitHub to watch it deploy automatically!
