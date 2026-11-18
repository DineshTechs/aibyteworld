# Deploying aibyte.world from GitHub

The blog is one Node.js app: the API server also serves the built website, with
search-engine tags written into each page. Any host that runs Node.js apps from a
GitHub repository works (for example Hostinger Node.js apps, Render, Railway, or a VPS).

## Host settings

| Setting | Value |
| --- | --- |
| Repository | this repository, branch `main` (auto-deploy on push) |
| Root directory | the repository root |
| Node.js version | 20 or newer (developed on 24) |
| Build command | `npm run build` |
| Start command | `npm start` |
| Port | the host's `PORT` variable (the app reads `PORT`; 5000 if not set) |

## Environment variables (set in the host's dashboard, never in the repository)

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `MONGODB_URI` | your MongoDB Atlas connection string |
| `DB_NAME` | `blogsite` (the same database you use now keeps all posts and settings) |
| `JWT_SECRET` | the value from your `server\.env` (or a new 64-character random string; everyone then signs in again) |
| `SECRETS_KEY` | **the exact value from your `server\.env`**. It decrypts the API keys saved in the dashboard; a different value means re-entering every key |
| `CLIENT_ORIGIN` | `https://aibyte.world,https://www.aibyte.world` |
| `UPLOAD_MAX_MB` | `5` (optional) |

In MongoDB Atlas → Network Access, allow the host's outgoing IP address (or 0.0.0.0/0 if the host has no fixed IP).

## After the first deploy

1. Point the domain `aibyte.world` (and `www`) at the host and turn on HTTPS.
2. Sign in at `https://aibyte.world/admin` → Website Settings → **Site URL** = `https://aibyte.world`.
   Sharing, IndexNow, newsletter links, the sitemap and canonical tags use it.
3. Google Search Console and Bing Webmaster Tools: add the site, paste the verification codes in
   Website Settings → Analytics, then submit `https://aibyte.world/sitemap.xml`.
4. Growth & Sharing → IndexNow → “Send my latest 50 posts now”.

## Things to know

- **Run one copy only.** Autopilot, the scheduler and the Telegram bot run inside the app. Stop the
  copy on your PC (close the start-dev windows) once the hosted site uses the same database;
  two copies would both poll the Telegram bot and Telegram allows only one.
- **Keep it awake.** Free plans that sleep when idle also pause Autopilot and Telegram.
- **Uploaded and downloaded photos live in `server/uploads`.** Use a host with a persistent disk
  (or a mounted volume at `server/uploads`); on hosts whose disk is wiped on each deploy, photos
  saved earlier disappear. Copy your current `server\uploads` folder to the host once, so existing
  posts keep their photos.
- `sharp` (photo optimiser) installs prebuilt binaries for Linux automatically.
