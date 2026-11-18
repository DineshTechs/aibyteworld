# Database

MongoDB via Mongoose. Models live in `server/src/models/`. Indexes are created automatically when
the server connects (they are safe to build repeatedly), so Phase 1 needs no migration script.
Later schema changes will ship with scripts in `server/src/scripts/migrations/`.

## Collections in Phase 1

### User
`name`, `email` (unique), `passwordHash` (bcrypt, never returned by the API), `role`
(`admin` | `editor` | `author`), `bio`, `avatarUrl`, `active`, `tokenVersion` (bumping it revokes
existing sessions), `lastLoginAt`, timestamps.

### Article
| Field | Notes |
| --- | --- |
| `title`, `slug` (unique), `excerpt` | Slug is generated from the title and kept unique |
| `content` | Sanitized HTML |
| `contentText` | Plain text copy used for search |
| `featuredImage` | `{ url, alt }` |
| `author` | ref User |
| `categories[]`, `tags[]` | refs |
| `status` | `draft`, `pending_approval`, `scheduled`, `published`, `archived` |
| `origin` | `manual` or `ai` |
| `featured` | Shown in the homepage hero |
| `seo` | `{ title, description, focusKeyword, canonicalUrl, noindex }` |
| `sources[]` | refs ResearchSource (filled from Phase 2) |
| `publishedAt`, `scheduledAt` | |
| `readingTime`, `views` | |
| `history[]` | `{ action, by, at, note }` — creation, edits and every status change |

Indexes: `slug` (unique) · `{status, publishedAt}` · `{status, scheduledAt}` ·
`{categories, status, publishedAt}` · `{tags, status, publishedAt}` · `{status, views}` · `author` ·
`origin` · text index on `title` (weight 10), `excerpt` (4), `contentText` (1).

### Category / Tag
`name`, `slug` (unique), `description` (Category only). Deleting one removes it from all articles.

### Media
`filename` (unique, random), `originalName`, `url`, `mimeType`, `size`, `alt`, `storage` (`local`, or
`remote` for Unsplash photos, which must be shown from Unsplash), `origin` (`upload`, `stock`), `sourceId` (library photo ID, so a photo is not reused), `width`, `height`, `credit { text, html }`, `provider`, `uploadedBy`. Files are stored in `server/uploads/`.

### SiteSettings
Single document (`key: "site"`): site name, tagline, description, URL, contact details, social
links, static page HTML (about, privacy, terms), `postsPerPage`, `allowIndexing`.

### ActivityLog
`actor`, `actorName`, `action` (for example `article.published`, `auth.login_failed`), `entityType`,
`entityId`, `summary`, `meta`, `ip`, `createdAt`.

### NewsletterSubscriber
`email` (unique), `status`, `source`.

## Phase 2 collections

### AIProvider
`key` (`gemini`, `openai`, `anthropic`, `tavily`, `nous`, `groq`, `cerebras`, `mistral`, `openrouter`, `ollama`), `enabled`, `isDefault`, `model`,
`modelOutputLimit`, `baseUrl` (Ollama), `apiKey` (`{ iv, tag, data }`, AES-256-GCM with `SECRETS_KEY`, never selected
by default), `apiKeyLast4`, `lastTest { at, ok, message }`,
`health { research?, writer?, image?: { until, code, message, at } }` (pauses after failures).
Photo libraries use the same collection: `openverse`, `unsplash`, `pexels`, `pixabay`.

### ResearchJob
`input` (topic, keywords, country, language, audience, length, style, category, instructions),
`status` (`queued`, `running`, `completed`, `failed`, `cancelled`), `steps[]`
(`key, label, status, attempts, startedAt, finishedAt, message, error, provider`), `provider`, `model`,
`analysis`, `research[]` (question, answer, queries, Google search-suggestion HTML, error),
`findings[]` (`fid, text, question, sources[], domains[], confidence, corroboration, conflict,
outdated, used`), `summary`, `plan`, `draftHtml`, `warnings[]`, `switches[]` (`at, step, from, to, reason`), `article`, `usage`,
`error`, `cancelRequested`, `lockedAt`, `createdBy`, timestamps. Indexes: `{status, createdAt}`,
`{createdAt}`.

### ResearchSource
`job`, `url` (unique per job), `domain`, `title`, `publishedAt`, `publishedAtSource`
(`page` | `unknown`), `httpStatus`, `reachable`, `retrievedAt`, `findingCount`.

### Later additions
- `ResearchJob`: `draftRaw`, `draftEdited`, `quality` (words, readability, AI-style phrases, citation
  counts), `seo` (generated metadata), `autopilot { enabled, trend, gate { passed, reasons, checkedAt }, published }`.
- `Article.seo`: `ogTitle`, `ogDescription`, `secondaryKeywords`, `faq[]` (rebuilt from the article's
  "Frequently asked questions" section on every save).
- `SiteSettings.autopilot`: schedule, niche, keywords, country, publishing mode, thresholds,
  `requireImage`, `nextRunAt`, `lastRunAt`, `lastResult`.
- `SiteSettings.ai`: `imageProviders`, `orderMode` (`quality` default, or `custom`), `imagesEnabled`,
  `inlineImages`.
- `ResearchJob`: an `images` step, `images[]`, `usage.images`.
- `Article.featuredImage`: `width`, `height`, `credit` (sanitized HTML caption).
- `Article.reads` (Number): visitors who read the post through. `Article.views` now counts unique
  daily visitors from the tracker instead of every page load.
- `SiteSettings.analytics`: `enabled` (built-in tracking), `gaMeasurementId`, `consentBanner`,
  `googleVerification`, `bingVerification`.
- New collections for analytics (no cookies, no IP addresses stored):
  - `ArticleStat` `{ day "YYYY-MM-DD", article, views, reads, readSeconds, timed }`, unique per day and article.
  - `ReferrerStat` `{ day, host, views }`: where visitors came from ("google", "x.com", "(direct)"…).
  - `VisitorMark` `{ key, at }`: keyed daily hashes so a visitor counts once per post per day;
    deleted automatically after 48 hours (TTL index).

- `TelegramBot` (one document): `enabled`, encrypted `token`, `tokenLast4`, `botUsername`,
  `chats[{ chatId, fromId, title, user, linkedAt }]`, `linkCode { code, user, expiresAt }`,
  `notify { held, review, submitted, published, failed, dailySummary }`, `summaryTime`,
  `lastSummaryDay`, `updateOffset`, `lastPollAt`, `lastError`.

All have defaults; no data update is needed.

### Changes to existing collections
- `Article.excerptIsAuto` (Boolean, default false) — whether the excerpt is generated from content.
- `SiteSettings.ai` — AI Content Studio defaults and limits, plus `researchProviders` and
  `writerProviders` (fallback order) and `knownProviders`.

### Data update scripts
`server/src/scripts/migrations.js` runs at server start and is safe to repeat. It appends providers
added in a new version to the fallback lists once (before Ollama) and records them in
`SiteSettings.ai.knownProviders`, so providers an admin removed are not added back.

New fields have defaults, so existing documents need no migration.

## Added in later phases

`PublishingJob` (Phase 4).

### Growth features

- **Article**: `language` (default `en`), `translationOf` (the original, for translations),
  `featuredImage.variants[] { width, url }`, `shares[] { channel, at, ok, ref, error }` (one entry per
  network, claimed atomically so a post is never shared twice), `refresh` (a waiting updated version:
  `{ job, title, content, seo, sources, featuredImage, words, createdAt }`), `refreshedAt`.
  Index `{ translationOf, language }`. Public lists use `translationOf: null` for original posts.
- **Media**: `variants[] { width, url, size }` (WebP copies).
- **NewsletterSubscriber**: status `pending` added; `confirmHash` (SHA-256, never returned),
  `confirmExpires`, `confirmSentAt`, `confirmedAt`, `unsubscribedAt`, `lastSentAt`.
- **ResearchJob**: `input.refreshOf` (refresh jobs), `autopilot.kind` (`trending` | `evergreen`).
- **SiteSettings.autopilot**: `evergreenPerDay` (default 2), `evergreenTopics[]`.
- **Growth** (one document, `key: "growth"`): `share` (telegram channel; X, LinkedIn and Facebook
  credentials encrypted with `SECRETS_KEY`, selected only on demand), `newsletter` (provider, encrypted
  API key, sender, double opt-in, digest day/time, last 20 sends), `indexnow` (key, last result),
  `links`, `translation`, `refresh`.
- **Translation**: `{ source, lang, status: queued|running|completed|failed, auto, article, provider,
  error, attempts, lockedAt }`; one runs at a time, stale ones are picked up again after 20 minutes.

No data update script is needed: new fields have defaults, and queries treat a missing
`translationOf` as an original post.
