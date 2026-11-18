# blogSite — AI-Powered Autonomous Blogging Platform

A blogging platform with a public editorial website and an admin dashboard. Articles can be written
manually today; AI research, generation and automated publishing are added phase by phase
(see `docs/IMPLEMENTATION_PLAN.md`).

**Current state: Phase 2 plus Autopilot, humanised writing and SEO** — Phase 1 (public website, admin dashboard, manual editor, auth and
roles, article APIs) plus the AI Content Studio: Google Gemini researches a topic with Grounding
with web search (Gemini, OpenAI or Anthropic), checks the findings, and writes a cited draft that waits
for approval, switching to the next provider when one runs out of quota (Nous and free local Ollama can
write).

| Part | Stack |
| --- | --- |
| `client/` | React 18, Vite, TypeScript, Tailwind CSS, TipTap editor |
| `server/` | Node.js, Express, MongoDB (Mongoose), JWT, Zod validation |

No Docker or Redis is needed. Everything runs on a standard Windows machine.

## Requirements

- Windows 10/11 (macOS/Linux also work with the manual steps)
- Node.js 18.18 or newer (LTS recommended) — <https://nodejs.org>
- A MongoDB database. A free MongoDB Atlas cluster works; a local MongoDB server works too.

## Windows setup (scripts)

1. Double-click **`setup.bat`**. It installs packages, then opens `server\.env` in Notepad.
2. Fill in `MONGODB_URI`, `ADMIN_EMAIL` and `ADMIN_PASSWORD`, save and close Notepad.
   In Atlas, make sure your IP address is allowed under *Network Access*.
3. Double-click **`setup.bat`** again. It creates the administrator and runs the API tests.
4. Double-click **`start-dev.bat`**.
   - Website: <http://localhost:5173>
   - Admin dashboard: <http://localhost:5173/admin>

Script output is saved in `logs\setup.log` and `logs\test.log`.

## Manual setup (any OS)

```bash
cd server
npm install
cp .env.example .env        # Windows: copy .env.example .env
npm run gen:secret          # fills JWT_SECRET
# edit .env: MONGODB_URI, ADMIN_EMAIL, ADMIN_PASSWORD
npm run seed:admin
npm run dev                 # API on http://localhost:5000

cd ../client
npm install
npm run dev                 # website on http://localhost:5173
```

## Environment variables

Server (`server/.env`, template in `server/.env.example`):

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | no | `development` | `development`, `test` or `production` |
| `PORT` | no | `5000` | API port |
| `CLIENT_ORIGIN` | no | `http://localhost:5173` | Allowed browser origin(s) for CORS, comma-separated |
| `LOG_LEVEL` | no | `info` | Log verbosity |
| `MONGODB_URI` | **yes** | — | MongoDB connection string |
| `DB_NAME` | no | `blogsite` | Database name. Tests use `<DB_NAME>_test` |
| `JWT_SECRET` | **yes** | — | Token signing secret, 32+ characters (`npm run gen:secret`) |
| `JWT_EXPIRES_IN` | no | `12h` | Session length |
| `ADMIN_NAME` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` | for seeding | — | Used only by `npm run seed:admin` |
| `UPLOAD_MAX_MB` | no | `5` | Maximum image upload size |
| `SECRETS_KEY` | for AI | — | Encrypts API keys saved in the dashboard (`npm run gen:secret` / `setup.bat` creates it). Changing it means re-entering keys |
| `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `TAVILY_API_KEY`, `NOUS_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY` | no | — | Fallback keys, used only when no key is saved in **AI Providers** |
| `OLLAMA_BASE_URL` | no | `http://127.0.0.1:11434` | Address of the local Ollama server (free models) |
| `UNSPLASH_ACCESS_KEY`, `PEXELS_API_KEY`, `PIXABAY_API_KEY` | no | — | Free stock photos for post images; can be set in **AI Providers** instead |

Client (`client/.env`, optional): `VITE_API_PROXY` — where the dev server proxies `/api` and `/uploads`
(default `http://localhost:5000`).

## Testing

```bash
cd server
npm test
```

The API tests (Phase 1 and the AI pipeline, with Gemini simulated so no key or cost is needed) run against a separate database named `<DB_NAME>_test` on the same MongoDB server and
remove their collections afterwards; your real data is not touched. On Windows you can double-click `run-tests.bat`
(it also runs the website type check and saves `logs\test.log` and `logs\typecheck.log`).

Frontend checks: `cd client && npm run typecheck && npm run build`.

## AI Content Studio (Phase 2)

| Provider | Research (web search) | Writing | Cost | Key |
| --- | --- | --- | --- | --- |
| Google Gemini | Grounding with Google Search | yes | free tier, then paid | <https://aistudio.google.com/apikey> |
| OpenAI | Responses API web search | yes | paid | <https://platform.openai.com/api-keys> |
| Anthropic Claude | Claude web search tool | yes | paid | <https://platform.claude.com/settings/keys> |
| Tavily | search engine (facts extracted by a writing model, quotes verified) | no | **free**: 1,000 searches a month | <https://app.tavily.com> |
| Nous Research | no | yes | paid | <https://portal.nousresearch.com> |
| Groq | no | yes | **free plan** (daily limits) | <https://console.groq.com/keys> |
| Cerebras | no | yes | **free tier** (daily token limit) | <https://cloud.cerebras.ai> |
| Mistral | no | yes | **free Experiment plan**; requests may be used for training | <https://console.mistral.ai/api-keys> |
| OpenRouter | no | yes | **free** `:free` models only (50 requests a day) | <https://openrouter.ai/settings/keys> |
| Ollama | no | yes | **free**, runs on your PC | none: <https://ollama.com>, then `ollama pull llama3.1` |

A completely free setup: Tavily for research plus Groq, Cerebras, Mistral or OpenRouter (or Ollama)
for writing. Free tiers have daily limits; when one is reached, the next provider in the list takes over.

1. In the dashboard open **AI Providers**, add a key (or the Ollama address), choose a model and
   click **Test connection** for each provider you want. Keys are encrypted on the server and never
   sent back to the browser.
2. Choose which providers to use for research, writing and images. With **Best quality first**
   (the default) every step starts with the best provider that is working: paid frontier models
   (Gemini, OpenAI, Claude) first, then large free models, then small or local ones. If a provider hits
   a rate limit, runs out of quota or credit, or has a key problem, the step switches to the next
   best one straight away (only the last one waits and retries). The failed provider is paused, for a
   minute after a rate limit, an hour after a used-up quota, 30 minutes after a key problem, and is
   then tried first again, so the better provider comes back as soon as it works. **Try now** on its
   card ends the pause. Switches and pauses are shown on the job page. Choose **My own order** to use
   the lists exactly as ordered instead.
3. Open **AI Content Studio**, fill in the topic and click **Research and write**. The article is
   saved as *Pending approval* (or *Draft*) and is never published automatically.

Research always needs web search (Gemini, OpenAI, Anthropic or Tavily). If every research provider is
out of quota, the job stops rather than writing without sources. With Tavily, facts are kept only if
the quote the model gives is found word for word in the search result. Free models are usually less
capable than paid ones, so review their drafts carefully. Ollama's speed depends on your computer.

## Images in posts

Every AI article gets a **cover photo** and, by default, **2 photos inside the article** (0 to 4,
set in AI Providers), placed after the first paragraph of evenly spread sections. Photos come from
free photo libraries; **images are never generated by AI**. A writing model suggests a photo search
and alt text for each; the photo's own description is used as alt text when it has one.

| Library | Cost | Notes | Key |
|---|---|---|---|
| **Openverse** (tried first) | **free** | openly licensed photos from Flickr, Wikimedia Commons and museums; only licences that allow commercial use; saved to your site | **none needed** |
| Unsplash | **free** (50 requests an hour for new apps) | shown from Unsplash, as its rules require | <https://unsplash.com/oauth/applications> |
| Pexels | **free** (200 searches an hour) | saved to your site | <https://www.pexels.com/api/> |
| **Wikimedia Commons** | **free** | millions of photos from the Wikipedia media library; only CC0, public domain, CC BY and CC BY-SA files without extra restrictions; a 1280 px copy is saved to your site. Wikimedia asks for contact details, so your public Site URL (or the contact email in Website Settings) is sent with each request | **none needed** |
| Pixabay | **free** (100 requests a minute) | saved to your site | <https://pixabay.com/api/docs/> |
| **NASA Images** (tried last) | **free** | space, science and engineering photos, generally not copyrighted; photos credited to news agencies are skipped | **none needed** |

Flickr is not offered: since 2025 its API keys need a Pro account, and a blog that earns ad revenue
needs a separately approved commercial key. Openverse already includes Flickr's openly licensed photos.

Each photo is captioned with the photographer and library, as the libraries ask (Openverse photos
also name the photo title and its Creative Commons licence, with links), and no photo is
used twice on the site. If a library is busy or has no fitting photo, the next one is used, with the
same pauses as text providers. When no cover photo is found, the cover search is tried once more a
few seconds later with a simpler search; if that also fails, the first in-article photo becomes the
cover. A post never fails for lack of a photo, but Autopilot holds posts without any cover photo for
approval (you can turn that off). Photos appear in the media library,
and you can swap them in the editor.

## Autopilot (trending topics on a schedule)

**Admin → Autopilot** writes posts on trending topics through the day. Defaults: Technology & AI,
worldwide, 4 posts a day at 00:00, 06:00, 12:00 and 18:00 India time.

For each post it finds stories from the last 48 hours (Tavily news search, or a web-search model),
lets a writing model pick one the blog has not covered, and runs the normal research → writing →
humanise → SEO pipeline. Headlines are treated as data only.

- **Publish automatically when every check passes** (default): at least 3 cited sources and 5 cited
  facts, no figures without a citation, no conflicting or outdated facts cited, at least 70% of the
  target length, every cited page reachable, no leftover AI-style phrases, SEO title and
  description present, a cover photo. Anything that fails stays in *Pending approval*, with the reasons on the
  Autopilot page and in Activity Logs.
- **Always wait for my approval**: posts are written on schedule but never published by Autopilot.

Each post uses about 6 web searches. Daily AI-article limits in AI Providers still apply.

**Evergreen mix.** Trending news brings a burst of readers that fades; evergreen guides ("how to…",
"best … for …", explainers) keep getting search visitors for months. *Evergreen guides per day*
(default 2 of 4) spreads them through the day: trending, guide, trending, guide. Topics come from
your own list first (one per line on the Autopilot page; each leaves the list once written), then
from a writing model that avoids anything already covered, using real article titles from Tavily as
hints when Tavily is set up. Evergreen posts go through the same research and quality checks.

## Growth: more readers from each post

**Admin → Growth & Sharing**, **Newsletter** and **Refresh Old Posts**. Sharing, IndexNow and
newsletter emails need a public *Site URL* (Website Settings); while it is empty or points to this
computer nothing is posted, and the page says so.

| Feature | What it does |
| --- | --- |
| Auto-share | Each published post goes once to a public **Telegram channel** (uses your bot; make it a channel admin), **X**, **LinkedIn** and a **Facebook Page**: title, summary, photo, link and hashtags from its tags. Keys are stored encrypted; *Check connection* tests them without posting. Failed channels can be retried from the post's editor. X may charge for API posts depending on your plan; LinkedIn tokens last about 60 days. |
| IndexNow | Tells Bing, Yandex, Seznam, Naver and others about new, changed and removed posts within minutes. The key file is served at `/<key>.txt` automatically. Google does not use IndexNow (it reads the sitemap). |
| Internal links | New AI articles link exact mentions of other posts' focus/secondary keywords to those posts (default up to 3), and when a post is published up to 3 older posts that mention its keyword get a link to it. Never inside headings, captions or existing links. |
| Hindi versions | Each newly published post is translated into Hindi at `/blog/<slug>-hi`. Blocks are translated with HTML, links, citations and every number kept exactly; a translation that changes any of them is rejected and retried. Published straight away when the original is published (can be switched off: then it waits for approval). Both versions carry `hreflang` links, the sitemap lists them, and a “हिन्दी” menu item appears. Lists, RSS and the newsletter stay English. |
| Newsletter | Brevo (300 emails/day free) or Resend (3,000/month free). Double opt-in confirmation, a weekly digest of the most-read new posts on the day and time you choose (Autopilot time zone), one-click unsubscribe in every email, CSV export, and a test email. |
| Faster photos | Downloaded and uploaded photos get WebP copies at 480, 960 and 1600 px with `srcset`, so phones load much less. Unsplash photos use Unsplash's own resizer. Needs the optional `sharp` library (installed by `setup.bat`); without it photos are served as before. *Optimise existing photos* converts older ones. Covers of 1200 px or more are preferred for Google Discover, and pages allow large image previews. |
| Refresh old posts | Posts older than 90 days are ranked by falling visits (last 4 weeks against the 4 before) and age. A refresh re-researches the topic and writes an updated version that waits on the post until you **Apply** (same address, “Updated” date shown) or **Discard** it — in the editor or with Telegram buttons. Default: one automatic refresh a week. |
| Reader extras | Reading progress bar, table of contents, share buttons (WhatsApp, Telegram, X, Facebook, LinkedIn, email, copy link, and the phone's share sheet). |

## Writing quality and SEO

Every AI article goes through a separate **humanise & edit** pass with a house style guide (varied
sentence length, plain words, no stock AI phrases). The edit is rejected, and the first draft kept,
if it changes citations, adds any figure not in the research, or cuts too much. The job page shows
reading ease, sentence variety and any AI-style phrases left.

A **fact fix** step then looks for paragraphs that state a figure (percentage, amount, money or
year) without a citation. Each one is either linked to the research finding that states that exact
figure, or reworded without the number. A rewrite is used only if it adds no new number or source;
otherwise the unsourced sentence is removed. So no unverified statistic reaches a published post,
and Autopilot posts are no longer held just because a model added a stray number.

An **SEO step** writes the SEO title, meta description, slug, keywords and social (Open Graph)
text. The site also provides:

- `/sitemap.xml`, `/robots.txt` (admin and API blocked) and `/rss.xml`
- Article (with the cover photo), BreadcrumbList, FAQPage (from the FAQ section), WebSite and Organization structured data
- cover photos in the sitemap, Open Graph image size tags, and width/height on every photo to avoid layout shift
- canonical URLs, Open Graph and Twitter cards, `noindex` for admin and search pages
- a live **SEO checklist** in the editor
- smaller public pages (the admin dashboard and editor load separately)

For search engines and social networks, run the **production mode**: double-click
`start-prod.bat`. It builds the website and serves everything from http://localhost:5000, writing
each page's title, description, canonical, Open Graph and structured data into the HTML on the
server (crawlers see them without running JavaScript), and returning a real 404 for missing pages.
Set **Public site URL** in Website Settings so links in the sitemap and tags use your domain. None of
this guarantees rankings or indexing.

## Analytics and search engines

- **Built-in analytics** (Admin → **Analytics**). For each post it counts:
  - **views**: unique visitors per day;
  - **reads**: visitors who reached 60% of the article and stayed active for at least 30% of its reading time;
  - **reading time** and **where visitors came from** (Google, X, direct…).
  It uses no cookies and does not store IP addresses: each visitor is identified by a code that changes
  daily, and only daily totals are kept. Bots and signed-in staff are not counted. You can turn it off
  in Website Settings.
- **Popular posts first.** The home page opens with **Most read** (most reads in the last 30 days) and
  **Trending this week** (most views in 7 days). The blog list can be sorted by most read or most viewed,
  and every post ends with a "Most read" list.
- **Google Analytics 4** (optional). Paste your measurement ID (`G-…`) in Website Settings. With the cookie
  banner on (the default), it loads only after a visitor clicks Accept, and "Cookie settings" in the footer
  lets visitors change their mind. "Write a starter privacy policy" fills in a privacy page that describes
  all of this; review it before publishing.
- **Google Search Console and Bing Webmaster Tools.** Paste the verification HTML tag in Website Settings.
  It is added to every page served by `start-prod.bat` (search engines check the live site, not the
  development server). Then submit `https://your-site/sitemap.xml`.

## Telegram notifications and approvals

Admin → **Telegram**:
1. Create a bot with [@BotFather](https://t.me/BotFather) (`/newbot`) and paste its token. It is
   checked with Telegram and stored encrypted.
2. Click **Link my Telegram**, open the bot and tap **Start**. The one-time code links that chat to
   your admin account.
3. Choose what to send:
   - Autopilot posts held for approval (with the reasons)
   - Posts Autopilot published
   - AI Studio articles ready for review
   - Posts authors submit
   - Problems (failed jobs, skipped Autopilot slots)
   - A daily summary at a time you choose

Approval messages have **Publish** and **Reject** buttons. Reject moves the post back to drafts.
Only the person who linked the chat can press them, and each action is logged under their account.

Refreshed posts arrive with **Apply update** / **Discard** buttons.

Commands: `/pending`, `/status`, `/stats`, `/run` (start an Autopilot post now), `/autopilot_on`,
`/autopilot_off`, `/unlink`.

The bot polls Telegram for messages, so it works without a public web address, but only while the
blog server is running.

## Roles

| Role | Can do |
| --- | --- |
| Administrator | Everything, including users, website settings, AI providers and activity logs |
| Editor | Manage and publish all articles, categories, tags and media; use the AI Content Studio |
| Author | Write own articles and submit them for approval; cannot publish |

## Documentation

- `docs/IMPLEMENTATION_PLAN.md` — phases, architecture and decisions
- `docs/API.md` — REST API reference
- `docs/DATABASE.md` — collections and indexes

- `DEPLOYMENT.md` — deploying from GitHub to a Node.js host (aibyte.world)
