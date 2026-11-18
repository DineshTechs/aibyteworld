# Implementation plan

Status on 17 Nov 2026: **Phase 1 complete and tested (20 tests). Phase 2 complete (10 providers incl. free ones, fallback, live article generated with free providers). Added ahead of plan: Autopilot (trending topics, 4 posts/day, publish only when checks pass), humanise pass, SEO step, sitemap/robots/RSS, server-rendered SEO tags (parts of Phases 3 and 4).**

## Environment found

| Item | Finding |
| --- | --- |
| Machine | Windows x64, project folder `D:\WebApps\blogSite` (empty at start) |
| Database | MongoDB Atlas (connection string supplied by the owner in `server/.env`) |
| Constraints | No Docker, no Redis; must run with plain Node.js on Windows |
| Node / npm / git | Node 24.21.0, npm 11.19.0, git 2.50.1 (from `logs/setup.log`) |

## Architecture

```
Browser ── Vite dev server (5173) ──proxy /api, /uploads──> Express API (5000) ──> MongoDB Atlas
                                                              │
                                                              ├─ in-process jobs (scheduler, later the AI pipeline queue)
                                                              ├─ AI provider adapters (Phase 2)
                                                              └─ Hermes task API (Phase 4)  <── Hermes agent
```

- **One Node process, no Redis.** Background work (scheduled publishing now, AI jobs later) uses
  MongoDB documents as the queue. A job is claimed with a single atomic `findOneAndUpdate`, which
  is what prevents duplicate publishing and lets jobs survive a restart.
- **Server in JavaScript (ES modules), client in TypeScript.** The server needs no build step,
  which keeps Windows setup to `npm install` and `npm run dev`.
- **Auth:** JWT in the `Authorization` header (not cookies), so CSRF does not apply. A
  `tokenVersion` on each user revokes sessions on password change, role change or deactivation.
- **Untrusted content:** all article HTML passes an allow-list sanitizer on the server before it
  is stored, and again in the browser before it is rendered. The same path will be used for
  AI-generated and researched content. Text fetched from the web is treated as data only and is
  never executed or followed as instructions.

## Phase 1 — Foundation (built)

| Area | Delivered |
| --- | --- |
| Setup | `client/`, `server/`, `docs/`, `.env.example`, `setup.bat`, `start-dev.bat`, `run-tests.bat` |
| Database | Models: User, Article, Category, Tag, Media, SiteSettings, ActivityLog, NewsletterSubscriber, with indexes for slug, status, categories, tags and text search |
| Auth & security | bcrypt hashing, JWT, roles (admin / editor / author), rate limiting, Zod validation, HTML sanitization, Helmet headers, CORS allow-list, image-only uploads verified by file signature, audit log |
| Article API | CRUD, status workflow (draft → pending approval → scheduled / published → archived), publication history, unique slugs, scheduled publishing job |
| Public site | Home (featured, latest, popular, trending topics, category sections, newsletter), blog list, article (TOC, breadcrumbs, share, related, previous/next), category, tag, author, search, About, Contact, Privacy, Terms, 404; light/dark theme; per-page meta, Open Graph, Twitter card, canonical, Article and Breadcrumb JSON-LD |
| Admin | Overview, Articles, Manual Editor, Categories, Tags, Media Library, Website Settings, User Management, Activity Logs, Profile |
| Manual editor | Rich text, images, categories, tags, SEO fields, author, preview, draft, publish, schedule, autosave, local backup with restore, leave-page warning |
| Tests | `server/tests/api.test.js`: 20 API tests covering auth, roles, validation, XSS, publishing rules, scheduling, uploads, settings, users, excerpts |
| Browser check | Category, media upload, editor autosave, featured image, tags, preview, publish, public article (TOC, breadcrumbs, meta, JSON-LD), home, category, tag, search and 404 pages verified in a browser. Fixed: auto excerpt joined headings and paragraphs; a brief API restart sent signed-in users to the sign-in page; Escape did not close dialogs |

The dashboard only shows sections that work. AI Content Studio, Research History, SEO Manager,
Publishing Calendar and AI Providers appear in the sidebar when their phase is built.

**Exit criteria:** `setup.bat` finishes with all tests passing; sign-in works; an article can be
written, previewed, published and read on the public site; an author cannot publish.

## Phase 2 — AI providers, research and generation (built)

- Models: `AIProvider`, `ResearchJob`, `ResearchSource`.
- Provider adapters behind one interface (`generate`, `listModels`, `testConnection`): Google Gemini
  (generateContent + Grounding with Google Search), OpenAI (Responses API + web search), Anthropic
  (Messages API + web search tool), Nous Research (OpenAI-compatible, writing only) and Ollama
  (free local models, writing only). API keys are stored encrypted on the server (AES-256-GCM with
  `SECRETS_KEY`) and never sent to the browser; the UI shows only the last four characters.
- Ordered fallback lists for research and for writing: when a provider runs out of quota, has a
  billing or key problem, or stays down after retries, the job switches to the next one.
- Research through the provider's web search, and a page checker with timeouts, size
  limits and private-network blocking (checked at connect time) that records each source's
  reachability and declared publication date.
- Pipeline steps 1–5 (topic analysis, research, verification, planning, writing) as a resumable
  job with a status per step, retries with backoff, and rate-limit and timeout handling.
- Every factual claim in a draft is linked to a stored source. Claims without a source are
  flagged, never filled in. The writing prompt is given only verified research notes.
- Admin: AI Content Studio (topic form, live progress), Research History, source viewer, AI Providers.
- Generated articles are saved as `origin: ai`, status `draft` or `pending_approval`.

**Decided:** Gemini first (Grounding with Google Search; Google's Custom Search JSON API is closed to
new customers and ends on 1 Jan 2027), then OpenAI and Anthropic as research fallbacks, with Nous and
free local Ollama as extra writing fallbacks. Google requires its Search Suggestions to be shown
wherever grounded results are displayed, so the research viewer renders them. The owner enters the
API keys. First live run (17 Nov 2026): the Gemini key worked but its free-tier daily quota was used
up, which led to the fallback feature.

**Added later (Nov 2026):** "best quality first" routing. Every model call starts with the best
ready provider (quality ranking by provider and model size, ties keep the admin's order). A provider
that fails is paused per role (1 minute after a rate limit, 1 hour after a used-up quota or no credit,
30 minutes after a key or model problem, 3 minutes after an outage) and then tried first again;
changing its key or model, a passing connection test, or **Try now** ends the pause.

## Phase 3 — SEO engine, images, quality checks, approval

- SEO generation (title, description, slug, keywords, Open Graph, alt text, FAQ schema),
  internal link suggestions, SEO Manager page.
- Server-side: `sitemap.xml`, `robots.txt`, RSS feed, and server-rendered meta tags for article
  URLs so crawlers and social networks that do not run JavaScript see them.
- Images, local storage, manual replace. **Built (Nov 2026):** cover plus in-article photos from
  free libraries (Openverse first, no key; then Unsplash, Pexels, Pixabay) with alt text, photographer credits, width/height,
  no reuse across the site, and failover. **Decided:** no AI image generation (owner's choice).
  Not done: resizing or WebP conversion (needs an image library such as `sharp`); libraries are
  asked for web-sized photos instead.
- Quality report: readability, duplicate content against existing articles, broken links,
  unsupported claims, missing citations, metadata, heading structure, images, completeness.
- Approval screen with the quality report next to the preview.

## Phase 4 — Hermes, publishing automation, scheduling

- `PublishingJob` model; daily, weekly and custom frequencies; time zones; queue view; retry of
  failed jobs; publishing history; Publishing Calendar.
- The three publishing modes. Automatic mode publishes only when every configured quality check
  passes; approval mode never publishes without a person approving.
- Hermes integration: authenticated task endpoints (separate scoped token, not a user login),
  documented payloads in `docs/HERMES_SETUP.md`, workflows and prompts in `hermes/`. Hermes never
  touches the database directly. If Hermes is down, the built-in pipeline from Phase 2 still works.
- **To confirm at the start of this phase:** the exact Hermes agent version and how it is run on
  your machine, so the integration is written against its real interface.

## Phase 5 — Analytics, hardening, deployment

- Integration points for Google Analytics 4, Search Console and Bing Webmaster Tools
  (verification tags, sitemap submission notes).
- Performance: production build served by the API, caching headers, image sizes, bundle check.
- Security review against the requirements list, dependency audit.
- `docs/DEPLOYMENT.md` for a Windows server and a typical Linux host.

No part of this guarantees search rankings or indexing; it implements the technical groundwork.

## Growth features (added)

Evergreen Autopilot mix, auto-sharing (Telegram channel, X, LinkedIn, Facebook), weekly newsletter
with double opt-in (Brevo/Resend), IndexNow, automatic internal links, Hindi versions with hreflang,
WebP photo copies with srcset (optional `sharp`), Discover-friendly covers and robots directives,
refresh of older posts with approval, and reader extras (progress bar, WhatsApp/Telegram/native
share). All outside services are switched off until configured, need a public Site URL before
anything is sent, and are covered by `server/tests/growth.test.js` with simulated services.

## Working rules for every phase

1. Write the phase, add tests for it, run the whole suite, and only then start the next phase.
2. Earlier tests keep passing; a phase is not done if it breaks one.
3. Schema changes ship with a safe update script.
4. New environment variables are added to `.env.example` and the README table.
5. No demo data in production code paths and no button without a working action.
