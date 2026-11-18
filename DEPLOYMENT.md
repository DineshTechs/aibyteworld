# Deploying aibyte.world on MilesWeb (cPanel Node.js hosting)

The blog is one Node.js app: the API server also serves the built website
(`client/dist`, committed to the repository) with search-engine tags in each page.
On MilesWeb it runs under cPanel's Node.js tool (CloudLinux "Setup Node.js App" or
"Application Manager"), which uses Phusion Passenger.

## 1. Connect GitHub and create the app (MilesWeb GitHub deploy)

In the MilesWeb panel, create a Node.js app from GitHub and choose:

| Setting | Value |
| --- | --- |
| Repository / branch | `DineshTechs/aibyteworld`, branch `main` (turn on auto-deploy on push) |
| Application root | the repository root (the folder with `package.json` and `app.js`) |
| Node.js version | 20 or newer (22 or 24 if offered) |
| Application mode | Production |
| Domain / URL | `aibyte.world` (no path) |
| Startup file | `app.js` |
| Install command (if asked) | `npm ci --omit=dev` (optional: `app.js` installs missing packages itself) |
| Build command (if asked) | leave empty: the website is already built in `client/dist` |
| Start command (if asked) | `npm start` |

Packages come from the root `package.json` / `package-lock.json` (the server's packages and the
`sharp` photo optimiser). If the panel does not install them, `app.js` runs `npm ci` itself on the
first start of each deploy (about a minute). The app listens on port 3000 unless the host sets `PORT`.

### If GitHub deploy is not available on your plan
cPanel → **Git Version Control** can clone the private repository with a deploy key
(cPanel → SSH Access → generate a key → GitHub repo → Settings → Deploy keys), into
`/home/<cpanel-user>/aibyteworld`; then cPanel → **Setup Node.js App** with the values above,
and **Update from Remote** + **Restart** for each new version.

## 2. Settings and photos: keep them outside the deploy folders

MilesWeb's GitHub deploys put each version in a new folder, for example
`/var/www/<site-id>/deploys/<version>`, and run the newest one. Anything stored inside a deploy
folder is gone after the next deploy, so `app.js` uses the **site folder** above `deploys`:

| What | Where (File Manager) |
| --- | --- |
| Settings | `/var/www/<site-id>/.env` |
| Photos | `/var/www/<site-id>/uploads/` (created automatically) |
| Start-up log | `/var/www/<site-id>/logs/app.log` |

1. Upload your PC's `D:\WebApps\blogSite\server\.env` to the site folder as `.env`, and change:
   ```
   NODE_ENV=production
   CLIENT_ORIGIN=https://aibyte.world,https://www.aibyte.world
   ```
   Keep `MONGODB_URI`, `DB_NAME`, `JWT_SECRET` and especially **`SECRETS_KEY`** exactly as they are
   (`SECRETS_KEY` decrypts the API keys saved in the dashboard). Remove the `PORT=` line or leave it:
   the host's port wins. Instead of the file, the same values can be entered as environment
   variables in the panel.
2. Zip your PC's `D:\WebApps\blogSite\server\uploads` folder, upload it and extract its files into
   `/var/www/<site-id>/uploads/`, so existing posts keep their photos.
3. MongoDB Atlas → **Network Access** → add the server's IP address (or 0.0.0.0/0).
4. Restart the app and open https://aibyte.world. If it shows 503, read `logs/app.log`.

On hosts without `deploys` folders (plain cPanel), the files stay in the usual places:
`server/.env` and `server/uploads`. Either can also be set with the `ENV_FILE` and `UPLOAD_DIR`
environment variables.

## 3. Keep it running (important)

Passenger starts the app on the first visit and can stop it when nobody visits, which
also pauses Autopilot, the newsletter and the Telegram bot. Add a cron job:
cPanel → **Cron Jobs** → every 5 minutes (`*/5 * * * *`):

```
curl -fsS https://aibyte.world/api/health > /dev/null
```

Run **one copy only**: stop the start-dev windows on your PC once the hosted site is live
(both use the same database, and Telegram allows one bot connection). If MilesWeb runs
several Passenger processes for the app, ask support to limit it to one instance.

## 4. After the first deploy

1. Sign in at https://aibyte.world/admin → Website Settings → **Site URL** = `https://aibyte.world`.
2. Google Search Console and Bing Webmaster Tools: paste the verification codes in Website
   Settings → Analytics, then submit `https://aibyte.world/sitemap.xml`.
3. Growth & Sharing → IndexNow → “Send my latest 50 posts now”.

## Updating

On your PC run `push-to-github.bat`: it builds the website, commits and pushes, and MilesWeb
redeploys from GitHub. If a new version needs new packages, run the install again in the panel.
