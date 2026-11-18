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
| Install command (if asked) | `npm install` |
| Build command (if asked) | leave empty: the website is already built in `client/dist` |
| Start command (if asked) | `npm start` |

The install reads the root `package.json` (the server's packages and the `sharp` photo
optimiser). If the panel has a **Run NPM Install** button instead, click it after the first deploy.

### If GitHub deploy is not available on your plan
cPanel → **Git Version Control** can clone the private repository with a deploy key
(cPanel → SSH Access → generate a key → GitHub repo → Settings → Deploy keys), into
`/home/<cpanel-user>/aibyteworld`; then cPanel → **Setup Node.js App** with the values above,
and **Update from Remote** + **Restart** for each new version.

## 2. Settings: upload `server/.env`

Easiest: with cPanel → **File Manager**, upload your PC's `D:\WebApps\blogSite\server\.env`
to `/home/<cpanel-user>/aibyteworld/server/.env` and change two lines:

```
NODE_ENV=production
CLIENT_ORIGIN=https://aibyte.world,https://www.aibyte.world
```

Keep `MONGODB_URI`, `DB_NAME`, `JWT_SECRET` and especially **`SECRETS_KEY` exactly as they are**:
`SECRETS_KEY` decrypts the API keys saved in the dashboard. The file is never in Git, and
redeploys from GitHub do not touch it (if your plan replaces the whole folder on each deploy, enter the values as environment variables instead). (The same values can instead be entered as
environment variables in the app's settings.)

MongoDB Atlas → **Network Access** → add the server's IP address (cPanel shows it as
"Shared IP Address"), or 0.0.0.0/0.

Restart the app in the panel and open https://aibyte.world.

## 3. Photos

Photos live in `server/uploads` (not in Git). Upload your PC's
`D:\WebApps\blogSite\server\uploads` folder once (zip it, upload with File Manager,
extract) so existing posts keep their photos.

After the first redeploy from GitHub, check that a post's photo still shows. If MilesWeb
replaces the whole app folder on each deploy, photos would be lost each time: ask MilesWeb
support to keep `server/uploads` between deploys (a persistent folder), and keep a copy.

## 4. Keep it running (important)

Passenger starts the app on the first visit and can stop it when nobody visits, which
also pauses Autopilot, the newsletter and the Telegram bot. Add a cron job:
cPanel → **Cron Jobs** → every 5 minutes (`*/5 * * * *`):

```
curl -fsS https://aibyte.world/api/health > /dev/null
```

Run **one copy only**: stop the start-dev windows on your PC once the hosted site is live
(both use the same database, and Telegram allows one bot connection). If MilesWeb runs
several Passenger processes for the app, ask support to limit it to one instance.

## 5. After the first deploy

1. Sign in at https://aibyte.world/admin → Website Settings → **Site URL** = `https://aibyte.world`.
2. Google Search Console and Bing Webmaster Tools: paste the verification codes in Website
   Settings → Analytics, then submit `https://aibyte.world/sitemap.xml`.
3. Growth & Sharing → IndexNow → “Send my latest 50 posts now”.

## Updating

On your PC run `push-to-github.bat`: it builds the website, commits and pushes, and MilesWeb
redeploys from GitHub. If a new version needs new packages, run the install again in the panel.
