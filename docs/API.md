# REST API (Phases 1–2)

Base URL in development: `http://localhost:5000/api` (the website calls it through the Vite proxy
as `/api`). All bodies are JSON unless noted. Errors look like
`{ "error": "message", "details": [{ "field": "title", "message": "Title is required" }] }`.

Authentication: send `Authorization: Bearer <token>`. Tokens come from `POST /auth/login`.
Lists are paged: `?page=1&limit=10` → `{ items, page, limit, total, pages }`.

## Health

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | `{ status, db }`; 503 when the database is not connected |

## Public (no authentication)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/public/settings` | Site name, contact details, static pages, `analytics { enabled, gaMeasurementId, consentBanner }` |
| GET | `/public/home` | `featured`, `latest`, `mostRead` (most reads in 30 days), `mostViewed` (most views in 7 days; also as `popular`), `trendingTags`, `categorySections` |
| GET | `/public/articles` | Published only, original-language posts by default; `lang=hi` lists Hindi versions. Filters: `category`, `tag` (slugs), `author` (id), `q` (search), `sort=latest\|most-read\|popular` (`popular` = most viewed) |
| GET | `/public/articles/:slug` | Article plus `related`, `popular` (most read), `previous`, `next`, `translations[]` (`{ title, slug, language }` of the other published language versions). Does not count a view |
| POST | `/public/track` | Analytics event from the browser: `{ articleId, type: "view"\|"read"\|"time", seconds?, referrer? }` → 204. Bots, unpublished posts and repeats (same visitor, post and day) are ignored; reads and time count only after a view; time is capped at 30 minutes |
| GET | `/public/categories` | With published article counts |
| GET | `/public/tags` | Tags in use, with counts |
| GET | `/public/authors/:id` | Public author profile |
| POST | `/public/newsletter` | `{ email }` → `{ message, confirm }`. With an email service and double opt-in, the address waits (`pending`) until the emailed link is used. Same answer whether or not it was already subscribed |
| POST | `/public/newsletter/confirm` | `{ token }` from the confirmation email (valid 7 days, works once) |
| POST | `/public/newsletter/unsubscribe` | `{ e, t }` in the body or the query (one-click unsubscribe from email apps). `t` is a keyed hash of the address |

## Authentication

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/login` | `{ email, password }` → `{ token, user }`. Rate limited |
| GET | `/auth/me` | Current user |
| PUT | `/auth/profile` | `{ name, bio, avatarUrl }` |
| POST | `/auth/change-password` | `{ currentPassword, newPassword }` → new token; other sessions are revoked |

## Admin (authenticated)

| Method | Path | Roles | Notes |
| --- | --- | --- | --- |
| GET | `/admin/stats` | all | Article counts (authors see their own) |
| GET | `/admin/analytics?days=7\|30\|90\|365` | admin, editor | `{ totals, previous, series[{day, views, reads}], mostViewed[], mostRead[], referrers[{host, views}], allTime, tracking, googleAnalytics, searchConsole }` |
| GET | `/admin/activity/recent` | all | Latest eight entries |
| GET | `/admin/articles` | all | Filters: `status`, `origin`, `q`. Authors see their own |
| POST | `/admin/articles` | all | Creates a draft (or another status if permitted) |
| GET | `/admin/articles/:id` | all | Includes content and history |
| PUT | `/admin/articles/:id` | all | Full update. `?autosave=1` skips the activity log entry |
| PATCH | `/admin/articles/:id/status` | all | `{ status, scheduledAt?, note? }` |
| DELETE | `/admin/articles/:id` | all | |
| GET | `/admin/categories`, `/admin/tags` | all | With article counts |
| POST | `/admin/categories` | admin, editor | `{ name, slug?, description? }` |
| POST | `/admin/tags` | all | `{ name, slug? }` |
| PUT, DELETE | `/admin/categories/:id`, `/admin/tags/:id` | admin, editor | |
| GET | `/admin/media` | all | |
| POST | `/admin/media` | all | `multipart/form-data`, field `file` (JPG, PNG, WebP, GIF) |
| PUT, DELETE | `/admin/media/:id` | owner, admin, editor | `{ alt }` |
| GET | `/admin/authors` | admin, editor | For the author picker |
| GET, POST | `/admin/users` | admin | `{ name, email, password, role }` |
| PUT, DELETE | `/admin/users/:id` | admin | `{ name, role, active, password? }` |
| GET, PUT | `/admin/settings` | admin | |
| GET | `/admin/activity` | admin | Filter: `action` prefix (for example `article`) |
| GET | `/admin/subscribers/count` | admin, editor | |

### Article body

```json
{
  "title": "Required",
  "slug": "optional-custom-slug",
  "excerpt": "",
  "content": "<h2>HTML</h2><p>Sanitized on the server.</p>",
  "featuredImage": { "url": "/uploads/file.jpg", "alt": "" },
  "categories": ["<categoryId>"],
  "tags": ["<tagId>"],
  "seo": { "title": "", "description": "", "focusKeyword": "", "canonicalUrl": "", "noindex": false },
  "status": "draft",
  "scheduledAt": null,
  "featured": false,
  "author": "<userId>"
}
```

### Publishing rules

- Authors can only set `draft` and `pending_approval`, and can only edit their own articles while
  they are in one of those two states.
- Only editors and administrators can set `published`, `scheduled` or `archived`.
- `scheduled` needs a future `scheduledAt`. A background job publishes due articles; each article
  is claimed atomically, so it cannot be published twice.
- An article with no content cannot be published.

## AI (Phase 2)

| Method | Path | Roles | Notes |
| --- | --- | --- | --- |
| GET | `/admin/ai/status` | admin, editor | `{ ready, reason, research: [{key,name,model}], writer: [...], images: [...] }`: the ready providers, best first |
| GET | `/admin/ai/providers` | admin | Providers with `kind` (`text`/`image`), `hasKey`, `apiKeyLast4`, `model`, `keySource` (`dashboard`, `env`), `quality { score, label }`, `health [{ role, until, code, message }]` (paused after a recent failure); never the key |
| PUT | `/admin/ai/providers/:key` | admin | `{ apiKey?, model?, enabled?, baseUrl? }` (`baseUrl` for Ollama). The model must be available to the key. Text keys: `gemini`, `openai`, `anthropic`, `tavily`, `nous`, `groq`, `cerebras`, `mistral`, `openrouter`, `ollama`. Photo library keys (images are never generated): `openverse` (no key), `unsplash`, `pexels`, `pixabay`. Tavily and the photo libraries have no model; Ollama has no key. Any change ends a pause |
| POST | `/admin/ai/providers/:key/reset-health` | admin | "Try now": ends the pause so the provider is tried first again |
| DELETE | `/admin/ai/providers/:key/key` | admin | Removes the saved key |
| GET | `/admin/ai/providers/:key/models` | admin | Models available to the key |
| POST | `/admin/ai/providers/:key/test` | admin | `{ ok, message }` |
| GET | `/admin/ai/settings` | admin, editor | `{ settings, effective: { research, writer, image } }`: defaults, limits and the order providers are tried in |
| PUT | `/admin/ai/settings` | admin | `{ maxResearchQuestions, maxSources, defaultLength, defaultStyle, defaultLanguage, defaultCountry, dailyJobLimit, outdatedAfterMonths, resultStatus, researchProviders: [...], writerProviders: [...], imageProviders?: [...], orderMode?: "quality" \| "custom", imagesEnabled?, inlineImages? (0-4) }`. Research providers must support web search (Tavily allowed); Tavily and image sources cannot write; only image sources can be in `imageProviders`. Omitted optional fields keep their value |
| POST | `/admin/ai/jobs` | admin, editor | Starts a job. Body below. 429 when the daily limit is reached |
| GET | `/admin/ai/jobs` | admin, editor | Filter `status` |
| GET | `/admin/ai/jobs/:id` | admin, editor | `{ item, sources }`: steps, analysis, findings, summary, plan, warnings, switches, quality, seo, `images [{ role, heading, url, alt, width, height, credit, provider }]`, usage |
| POST | `/admin/ai/jobs/:id/cancel` | admin, editor | Queued: cancelled now. Running: stops at the next checkpoint |
| POST | `/admin/ai/jobs/:id/retry` | admin, editor | Failed or cancelled jobs resume from the first unfinished step |

```json
{
  "topic": "Best AI tools for small businesses in 2026",
  "primaryKeyword": "AI tools for small businesses",
  "secondaryKeywords": ["AI software for SMBs"],
  "country": "USA",
  "language": "English",
  "audience": "Owners of businesses with under 50 staff",
  "length": 2000,
  "style": "Professional and informative",
  "category": "<categoryId or null>",
  "instructions": ""
}
```

### Pipeline

| Step | What happens |
| --- | --- |
| Topic analysis | Search intent, audience, keywords, outline and research questions (JSON) |
| Internet research | One web-search call per question with the research provider (Gemini grounding, OpenAI web search, Claude web search, or Tavily search followed by fact extraction with a writing model; each extracted fact must quote a result word for word and the quote is checked on the server). Findings are the answer segments the provider ties to specific pages (grounding supports, url_citation annotations or web_search_result_location citations). Redirect links are resolved, and each page is checked for reachability and its declared publication date |
| Research verification | Corroboration (2+ sites), possibly outdated sources, conflicts between findings, research summary |
| Article planning | H1, H2/H3 sections mapped to findings, FAQ, internal links to existing published articles |
| Article writing | HTML body citing findings as `[F#]`; converted to numbered source links plus a Sources list. Unknown markers are removed and uncited figures are flagged |
| Save draft | Article with `origin: ai`, status `pending_approval` or `draft`, research sources attached |

When a provider hits a limit (rate limit, used-up quota, no credit, bad key, missing model), the job
switches to the next provider in the research or writing fallback list immediately and records the
switch in `switches[]` and `warnings`. Timeouts and 5xx errors get one retry before switching. Only
the last provider in a list waits and retries (up to 3 times, honouring the provider's retry delay).
"No credits" / insufficient-quota errors are never retried. Jobs are stored in MongoDB and resume after a restart.

## Autopilot (admin)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/admin/autopilot` | `{ settings, slots, nextRunLocal, lastRunLocal, jobs }` |
| PUT | `/admin/autopilot` | `{ enabled, postsPerDay, startTime "HH:MM", timezone, niche, keywords[], country, language, category, length, style, publishMode: "auto_if_checks_pass" \| "approval", minSources, minCitedFindings }` |
| POST | `/admin/autopilot/run` | Starts one post now. 409 when every trending story is already covered |

A scheduler checks every minute and claims each slot atomically, so a slot starts exactly one post.

## SEO (public)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/sitemap.xml` | Published, indexable articles; categories and tags in use; static pages |
| GET | `/robots.txt` | Blocks `/admin`, `/api/`, `/search`; links the sitemap. Blocks everything when indexing is off |
| GET | `/rss.xml` | Latest 20 published articles |

In production (a built `client/dist` exists), every other GET that accepts HTML returns the website
with server-rendered `<head>` tags and the right status (404 for unknown pages).

### Pipeline steps (updated)

Topic analysis → Internet research → Research verification → Article planning → Article writing →
**Humanise & edit** → **Fact fix** (unsourced figures linked to a finding, reworded, or removed) →
**SEO optimisation** → **Images** → Save draft.

## Telegram (admin)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/admin/telegram` | `{ enabled, hasToken, tokenLast4, botUsername, botLink, chats[], notify{held,review,submitted,published,failed,dailySummary}, summaryTime, timezone, linkCode, lastPollAt, lastError }`. Never the token |
| PUT | `/admin/telegram` | `{ token?, enabled?, notify?, summaryTime? "HH:MM" }`. A token is checked with Telegram (`getMe`), its webhook is removed, and it is stored encrypted |
| DELETE | `/admin/telegram/token` | Removes the bot and all linked chats |
| POST | `/admin/telegram/link` | Creates a one-time link code (15 minutes) and a `t.me/<bot>?start=<code>` link |
| DELETE | `/admin/telegram/chats/:chatId` | Unlinks a chat |
| POST | `/admin/telegram/test` | Sends a test message to linked chats |

Button presses (`a:<articleId>` publish, `r:<articleId>` back to draft) are accepted only from the
Telegram account that linked the chat, and only for posts still waiting for approval.

Refresh buttons: `u:<articleId>` applies a waiting updated version, `d:<articleId>` discards it.

## Growth (admin unless noted)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/admin/growth` | Sharing channels (ready flags, last4, last error, never keys), newsletter settings with subscriber counts and send history, IndexNow key and last result, link, translation and refresh settings, recent translations, photo optimiser status |
| PUT | `/admin/growth` | Any of `share`, `newsletter`, `indexnow`, `links`, `translation`, `refresh` (see `growthController.js` for fields). Secret fields left empty keep the saved value; new ones are stored encrypted |
| DELETE | `/admin/growth/keys/:name` | `x`, `linkedin`, `facebook` or `newsletter`; also switches that feature off |
| POST | `/admin/growth/check/:channel` | `telegram`, `x`, `linkedin`, `facebook`: tests the connection without posting. LinkedIn fills in the author when empty |
| POST | `/admin/growth/indexnow` | Sends the home page and the latest 50 posts |
| POST | `/admin/media/optimize` | Makes WebP copies for up to 40 photos without them and adds `srcset` to posts using them. 400 when `sharp` is not installed |
| POST | `/admin/articles/:id/share` | Editor/admin. Shares a published post to ready channels it has not reached (failed ones are retried) |
| POST | `/admin/articles/:id/translate` | Editor/admin. `{ lang: "hi" }` → 202; queues a translation (updates the existing one) |
| GET | `/admin/refresh` | Editor/admin. `candidates[]` with reasons, `waiting[]` updated versions, recent refresh `jobs[]`, settings |
| POST | `/admin/articles/:id/refresh` | Editor/admin. Starts a refresh job for a published original post |
| POST | `/admin/articles/:id/refresh/apply` | Editor/admin. Replaces title, content, sources and SEO text with the updated version; slug, focus keyword and canonical are kept |
| DELETE | `/admin/articles/:id/refresh` | Editor/admin. Discards the updated version |
| POST | `/admin/newsletter/test` | Sends a test digest to the signed-in admin |
| POST | `/admin/newsletter/send` | Sends the digest now to all confirmed subscribers |
| GET | `/admin/newsletter/subscribers` | Editor/admin. `status`, `q`, paging |
| GET | `/admin/newsletter/subscribers.csv` | CSV export (values that start with `= + - @` are prefixed with `'`) |
| DELETE | `/admin/newsletter/subscribers/:id` | Removes an address completely |

`POST /admin/autopilot/run` accepts `{ kind: "trending" | "evergreen" }` (default trending).
`GET /admin/autopilot` also returns `slotKinds[]` and `nextKind`.

Public: `GET /<indexnow-key>.txt` returns the IndexNow key while IndexNow is on.
