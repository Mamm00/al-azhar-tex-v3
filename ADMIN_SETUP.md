# Admin Panel Setup — Al Azhar Tex

## 3-Step Setup

### Step 1 — Enable Netlify Identity
1. Netlify Dashboard → your site → **Identity** tab
2. Click **Enable Identity**
3. Under **Registration** → set to **Invite only**
4. Click **Invite users** → enter your email → accept the invite

### Step 2 — Set Environment Variables
Netlify Dashboard → Site Settings → **Environment Variables** → Add:

| Variable | Value |
|---|---|
| `GITHUB_TOKEN` | Your GitHub Personal Access Token (Settings → Developer Settings → Tokens → repo scope) |
| `GITHUB_OWNER` | Your GitHub username (e.g. `shadyanwar`) |
| `GITHUB_REPO` | Repository name (e.g. `al-azhar-tex`) |
| `ADMIN_SECRET` | Any secret string (optional backup auth) |

### Step 3 — Deploy & Login
1. Push code to GitHub → Netlify auto-deploys
2. Visit `https://yoursite.netlify.app/admin`
3. Click **Sign In** → login with your invited email
4. Done ✅

---

## How Data Saves
Every product change (add/edit/delete) uses the GitHub API to update `src/_data/products.json` in your repo → Netlify detects the commit → triggers a new deploy (~30 seconds).

## Local Development
```bash
npm install
netlify dev   # runs site + functions locally at localhost:8888
```
Visit `http://localhost:8888/admin` to test the admin panel locally.
