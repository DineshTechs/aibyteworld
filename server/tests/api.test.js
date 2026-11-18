// Phase 1 API tests. They run against "<DB_NAME>_test" on the configured
// MongoDB server and drop that database when finished. Run: npm test
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.NODE_ENV = 'test';
const { env } = await import('../src/config/env.js');
env.DB_NAME = `${env.DB_NAME}_test`;

const { default: mongoose } = await import('mongoose');
const { default: bcrypt } = await import('bcryptjs');
const { default: request } = await import('supertest');
const { connectDb, disconnectDb } = await import('../src/config/db.js');
const { createApp } = await import('../src/app.js');
const { User, Article } = await import('../src/models/index.js');
const { publishDueArticles } = await import('../src/jobs/publishScheduler.js');
const { removeUploadedFile } = await import('../src/middleware/upload.js');

const app = createApp();
const PASSWORD = 'test-password-123';
const tokens = {};
const ids = {};
const uploaded = [];

// Drops only this app's collections inside the *_test database.
async function dropTestCollections() {
  assert.match(mongoose.connection.name, /_test$/, 'tests must use a *_test database');
  for (const m of Object.values(mongoose.models)) {
    await m.collection.drop().catch(() => {});
  }
}

const as = (role) => ({ Authorization: `Bearer ${tokens[role]}` });

before(async () => {
  await connectDb();
  assert.match(mongoose.connection.name, /_test$/, 'tests must use a *_test database');
  await dropTestCollections();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  for (const role of ['admin', 'editor', 'author']) {
    const u = await User.create({ name: `Test ${role}`, email: `${role}@example.test`, role, passwordHash });
    ids[role] = String(u._id);
  }
});

after(async () => {
  uploaded.forEach(removeUploadedFile);
  await dropTestCollections();
  await disconnectDb();
});

test('health check reports a connected database', async () => {
  const res = await request(app).get('/api/health').expect(200);
  assert.equal(res.body.db, 'connected');
  assert.ok(res.body.uptimeSeconds >= 0 && res.body.startedAt, 'shows how long the app has been running');
});

test('site SEO: default share image, logo and social profiles for search engines', async () => {
  const { renderHead, headToHtml } = await import('../src/services/seoService.js');
  const { SiteSettings } = await import('../src/models/index.js');
  await SiteSettings.getSingleton(); // a fresh test database has no settings yet
  await SiteSettings.updateOne({ key: 'site' }, { $set: { siteName: 'AI BYTE WORLD', tagline: 'AI news', description: 'Clear AI news.', 'social.twitter': 'https://x.com/aibyteworld', 'social.linkedin': 'https://www.linkedin.com/company/aibyteworld' } });
  const head = await renderHead('/', 'https://www.example.org');
  const html = headToHtml(head, 'AI BYTE WORLD');
  assert.match(html, /<meta property="og:image" content="https:\/\/www\.example\.org\/og-default\.png" \/>/);
  assert.match(html, /<meta property="og:image:width" content="1200" \/>/);
  assert.match(html, /<meta name="twitter:site" content="@aibyteworld" \/>/);
  const graph = head.ld[0]['@graph'];
  const org = graph.find((x) => x['@type'] === 'Organization');
  assert.equal(org.logo.url, 'https://www.example.org/icon-512.png');
  assert.deepEqual(org.sameAs.sort(), ['https://www.linkedin.com/company/aibyteworld', 'https://x.com/aibyteworld']);
  assert.equal(graph.find((x) => x['@type'] === 'WebSite').description, 'Clear AI news.');
  await SiteSettings.updateOne({ key: 'site' }, { $set: { 'social.twitter': '', 'social.linkedin': '', tagline: '', description: '' } });
});

test('login: rejects bad credentials, accepts good ones', async () => {
  await request(app).post('/api/auth/login').send({ email: 'admin@example.test', password: 'wrong-password' }).expect(401);
  await request(app).post('/api/auth/login').send({ email: 'nobody@example.test', password: PASSWORD }).expect(401);
  await request(app).post('/api/auth/login').send({ email: 'not-an-email' }).expect(400);
  for (const role of ['admin', 'editor', 'author']) {
    const res = await request(app).post('/api/auth/login').send({ email: `${role}@example.test`, password: PASSWORD }).expect(200);
    assert.ok(res.body.token);
    assert.equal(res.body.user.role, role);
    assert.equal(res.body.user.passwordHash, undefined);
    tokens[role] = res.body.token;
  }
});

test('admin routes require a valid token', async () => {
  await request(app).get('/api/admin/articles').expect(401);
  await request(app).get('/api/admin/articles').set('Authorization', 'Bearer garbage').expect(401);
  const me = await request(app).get('/api/auth/me').set(as('admin')).expect(200);
  assert.equal(me.body.user.email, 'admin@example.test');
});

test('role-based access: authors cannot manage users, settings or categories', async () => {
  await request(app).get('/api/admin/users').set(as('author')).expect(403);
  await request(app).get('/api/admin/users').set(as('editor')).expect(403);
  await request(app).get('/api/admin/settings').set(as('editor')).expect(403);
  await request(app).post('/api/admin/categories').set(as('author')).send({ name: 'Nope' }).expect(403);
  await request(app).get('/api/admin/users').set(as('admin')).expect(200);
});

test('categories and tags: create, validate, unique slugs', async () => {
  const c1 = await request(app).post('/api/admin/categories').set(as('editor')).send({ name: 'Technology', description: 'Tech news' }).expect(201);
  assert.equal(c1.body.item.slug, 'technology');
  ids.category = c1.body.item._id;
  const c2 = await request(app).post('/api/admin/categories').set(as('editor')).send({ name: 'Technology' }).expect(201);
  assert.equal(c2.body.item.slug, 'technology-2');
  ids.category2 = c2.body.item._id;
  await request(app).post('/api/admin/categories').set(as('editor')).send({ name: '' }).expect(400);
  const t = await request(app).post('/api/admin/tags').set(as('author')).send({ name: 'AI Tools' }).expect(201);
  assert.equal(t.body.item.slug, 'ai-tools');
  ids.tag = t.body.item._id;
});

test('articles: validation and XSS sanitization', async () => {
  await request(app).post('/api/admin/articles').set(as('editor')).send({ title: '' }).expect(400);
  await request(app).post('/api/admin/articles').set(as('editor')).send({ title: 'x', categories: ['not-an-id'] }).expect(400);
  await request(app).post('/api/admin/articles').set(as('editor')).send({ title: 'x', featuredImage: { url: 'javascript:alert(1)' } }).expect(400);

  const res = await request(app)
    .post('/api/admin/articles')
    .set(as('editor'))
    .send({
      title: 'Hello <script>alert(1)</script>World',
      content:
        '<h2>Intro</h2><p onclick="steal()">Safe text</p><script>alert("xss")</script>' +
        '<a href="javascript:alert(1)">bad</a><img src="x" onerror="alert(1)"><iframe src="https://evil.test"></iframe>',
      categories: [ids.category],
      tags: [ids.tag],
    })
    .expect(201);
  const { article } = res.body;
  ids.article = article._id;
  assert.equal(article.status, 'draft');
  assert.equal(article.origin, 'manual');
  assert.ok(!/script|onclick|onerror|javascript:|iframe/i.test(article.content), article.content);
  assert.equal(article.title, 'Hello World');
  assert.match(article.content, /<h2>Intro<\/h2>/);
  assert.ok(article.slug.startsWith('hello'));
});

test('drafts are not visible publicly', async () => {
  const list = await request(app).get('/api/public/articles').expect(200);
  assert.equal(list.body.total, 0);
  const full = await request(app).get(`/api/admin/articles/${ids.article}`).set(as('editor')).expect(200);
  await request(app).get(`/api/public/articles/${full.body.article.slug}`).expect(404);
});

test('authors: own drafts only, cannot publish, can submit for approval', async () => {
  const created = await request(app)
    .post('/api/admin/articles')
    .set(as('author'))
    .send({ title: 'Author draft', content: '<p>Written by an author with enough words to search for platypus.</p>' })
    .expect(201);
  ids.authorArticle = created.body.article._id;

  await request(app).post('/api/admin/articles').set(as('author')).send({ title: 'Sneaky', content: '<p>x</p>', status: 'published' }).expect(403);
  await request(app).patch(`/api/admin/articles/${ids.authorArticle}/status`).set(as('author')).send({ status: 'published' }).expect(403);
  await request(app).put(`/api/admin/articles/${ids.article}`).set(as('author')).send({ title: 'Hijack' }).expect(403);
  await request(app).get(`/api/admin/articles/${ids.article}`).set(as('author')).expect(403);
  await request(app).delete(`/api/admin/articles/${ids.article}`).set(as('author')).expect(403);

  const mine = await request(app).get('/api/admin/articles').set(as('author')).expect(200);
  assert.equal(mine.body.total, 1);

  const pending = await request(app).patch(`/api/admin/articles/${ids.authorArticle}/status`).set(as('author')).send({ status: 'pending_approval' }).expect(200);
  assert.equal(pending.body.article.status, 'pending_approval');
});

test('editors approve and publish; published articles become public', async () => {
  const approved = await request(app).patch(`/api/admin/articles/${ids.authorArticle}/status`).set(as('editor')).send({ status: 'published' }).expect(200);
  assert.equal(approved.body.article.status, 'published');
  assert.ok(approved.body.article.publishedAt);
  const slug = approved.body.article.slug;

  // Once approved, the author can no longer change it without an editor.
  await request(app).put(`/api/admin/articles/${ids.authorArticle}`).set(as('author')).send({ title: 'Changed after approval' }).expect(403);

  const list = await request(app).get('/api/public/articles').expect(200);
  assert.equal(list.body.total, 1);
  assert.equal(list.body.items[0].content, undefined);

  const one = await request(app).get(`/api/public/articles/${slug}`).expect(200);
  assert.equal(one.body.article.author.email, undefined);
  // Opening a post does not count a view by itself: the tracker does (see the analytics test).
  const two = await request(app).get(`/api/public/articles/${slug}`).expect(200);
  assert.equal(two.body.article.views, 0);

  const search = await request(app).get('/api/public/articles?q=platypus').expect(200);
  assert.equal(search.body.total, 1);
  const none = await request(app).get('/api/public/articles?q=zebracorn').expect(200);
  assert.equal(none.body.total, 0);
});

const BROWSER_A = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const BROWSER_B = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

test('analytics: unique views, real reads and reading time; bots and repeats are not counted; popular posts come first', async () => {
  const post = await Article.findOne({ status: 'published' });
  const id = String(post._id);
  const track = (ua, body) => request(app).post('/api/public/track').set('User-Agent', ua).send({ articleId: id, ...body });

  await track(BROWSER_A, { type: 'read' }).expect(204); // a read without a view is ignored
  await track(BROWSER_A, { type: 'view', referrer: 'https://www.google.com/' }).expect(204);
  await track(BROWSER_A, { type: 'view', referrer: 'https://www.google.com/' }).expect(204); // same visitor, same day
  await track(BROWSER_B, { type: 'view', referrer: 'https://t.co/abc' }).expect(204);
  await track(GOOGLEBOT, { type: 'view' }).expect(204); // bots are skipped
  await track(BROWSER_A, { type: 'read' }).expect(204);
  await track(BROWSER_A, { type: 'read' }).expect(204);
  await track(BROWSER_A, { type: 'time', seconds: 95 }).expect(204);
  await track(BROWSER_B, { type: 'time', seconds: 5000 }).expect(204); // capped at 30 minutes
  await request(app).post('/api/public/track').send({ articleId: 'nope', type: 'view' }).expect(400);
  await request(app).post('/api/public/track').send({ articleId: id, type: 'like' }).expect(400);

  const after = await Article.findById(id).lean();
  assert.equal(after.views, 2);
  assert.equal(after.reads, 1);

  // Home page: most read and most viewed lists; blog list sorts.
  const home = await request(app).get('/api/public/home').expect(200);
  assert.equal(home.body.mostRead[0]._id, id);
  assert.equal(home.body.mostViewed[0]._id, id);
  assert.equal(home.body.mostRead[0].reads, 1);
  const byReads = await request(app).get('/api/public/articles?sort=most-read').expect(200);
  assert.equal(byReads.body.items[0]._id, id);

  // Dashboard numbers (staff only).
  await request(app).get('/api/admin/analytics').set(as('author')).expect(403);
  const dash = await request(app).get('/api/admin/analytics?days=7').set(as('editor')).expect(200);
  assert.equal(dash.body.days, 7);
  assert.equal(dash.body.series.length, 7);
  assert.deepEqual(dash.body.totals, { views: 2, reads: 1, readRate: 0.5, avgReadSeconds: Math.round((95 + 1800) / 2) });
  assert.equal(dash.body.mostViewed[0].title, post.title);
  assert.deepEqual(dash.body.referrers.map((r) => r.host).sort(), ['google', 'x.com']);
  assert.equal(dash.body.series.at(-1).views, 2);

  // Built-in tracking can be turned off.
  const base = { siteName: 'Test Blog', postsPerPage: 6 };
  await request(app).put('/api/admin/settings').set(as('admin')).send({ ...base, analytics: { enabled: false } }).expect(200);
  await track('Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0', { type: 'view' }).expect(204);
  assert.equal((await Article.findById(id).lean()).views, 2);
  await request(app).put('/api/admin/settings').set(as('admin')).send({ ...base, analytics: { enabled: true } }).expect(200);
});

test('Google Analytics and Search Console settings: validated, public where needed, verification tags in the page head', async () => {
  const base = { siteName: 'Test Blog', postsPerPage: 6 };
  const bad = await request(app).put('/api/admin/settings').set(as('admin')).send({ ...base, analytics: { gaMeasurementId: 'UA-12345-1' } }).expect(400);
  assert.match(JSON.stringify(bad.body), /G-ABC123XYZ/);
  await request(app).put('/api/admin/settings').set(as('admin')).send({ ...base, analytics: { googleVerification: '<script>' } }).expect(400);
  const ok = await request(app)
    .put('/api/admin/settings')
    .set(as('admin'))
    .send({ ...base, analytics: { gaMeasurementId: 'g-test123abc', googleVerification: '<meta name="google-site-verification" content="AbC_123-verifyCode9" />', bingVerification: '0123456789ABCDEF0123456789ABCDEF' } })
    .expect(200);
  assert.equal(ok.body.settings.analytics.gaMeasurementId, 'G-TEST123ABC');
  assert.equal(ok.body.settings.analytics.googleVerification, 'AbC_123-verifyCode9');
  const pub = await request(app).get('/api/public/settings').expect(200);
  assert.deepEqual(pub.body.settings.analytics, { enabled: true, gaMeasurementId: 'G-TEST123ABC', gtmContainerId: '', consentBanner: true });
  // Tag Manager: the ID is taken out of a pasted snippet; anything else is refused.
  await request(app).put('/api/admin/settings').set(as('admin')).send({ ...base, analytics: { gtmContainerId: 'hello' } }).expect(400);
  const snippet = '<script async src="https://www.googletagmanager.com/gtm.js?id=GTM-5J36KQRM"></script>';
  const g = await request(app).put('/api/admin/settings').set(as('admin')).send({ ...base, analytics: { gaMeasurementId: 'G-TEST123ABC', gtmContainerId: snippet, googleVerification: 'AbC_123-verifyCode9', bingVerification: '0123456789ABCDEF0123456789ABCDEF' } }).expect(200);
  assert.equal(g.body.settings.analytics.gtmContainerId, 'GTM-5J36KQRM');
  assert.equal((await request(app).get('/api/public/settings').expect(200)).body.settings.analytics.gtmContainerId, 'GTM-5J36KQRM');
  const { renderHead, headToHtml } = await import('../src/services/seoService.js');
  const head = headToHtml(await renderHead('/', 'https://blog.example.test'), 'Test Blog');
  assert.match(head, /<meta name="google-site-verification" content="AbC_123-verifyCode9" \/>/);
  assert.match(head, /<meta name="msvalidate\.01" content="0123456789ABCDEF0123456789ABCDEF" \/>/);
  // Saving the other settings without the analytics block keeps it.
  await request(app).put('/api/admin/settings').set(as('admin')).send(base).expect(200);
  const kept = await request(app).get('/api/admin/settings').set(as('admin')).expect(200);
  assert.equal(kept.body.settings.analytics.gaMeasurementId, 'G-TEST123ABC');
});

test('auto excerpt separates blocks and follows content edits; typed excerpt is kept', async () => {
  const created = await request(app).post('/api/admin/articles').set(as('editor')).send({ title: 'Excerpt check', content: '<h2>Intro</h2><p>First line.</p><ul><li>One</li><li>Two</li></ul>' }).expect(201);
  const a = created.body.article;
  assert.equal(a.excerpt, 'Intro First line. One Two');
  const edited = await request(app).put(`/api/admin/articles/${a._id}`).set(as('editor')).send({ title: a.title, excerpt: a.excerpt, content: '<p>Rewritten body.</p>' }).expect(200);
  assert.equal(edited.body.article.excerpt, 'Rewritten body.');
  const typed = await request(app).put(`/api/admin/articles/${a._id}`).set(as('editor')).send({ title: a.title, excerpt: 'My own summary', content: '<p>Rewritten body.</p>' }).expect(200);
  assert.equal(typed.body.article.excerpt, 'My own summary');
  const again = await request(app).put(`/api/admin/articles/${a._id}`).set(as('editor')).send({ title: a.title, excerpt: 'My own summary', content: '<p>Changed again.</p>' }).expect(200);
  assert.equal(again.body.article.excerpt, 'My own summary');
  await request(app).delete(`/api/admin/articles/${a._id}`).set(as('editor')).expect(204);
});

test('publishing an empty article is rejected', async () => {
  const empty = await request(app).post('/api/admin/articles').set(as('editor')).send({ title: 'Empty' }).expect(201);
  await request(app).patch(`/api/admin/articles/${empty.body.article._id}/status`).set(as('editor')).send({ status: 'published' }).expect(400);
  await request(app).delete(`/api/admin/articles/${empty.body.article._id}`).set(as('editor')).expect(204);
});

test('update keeps slugs unique; category filter and home endpoint work', async () => {
  const upd = await request(app)
    .put(`/api/admin/articles/${ids.article}`)
    .set(as('editor'))
    .send({ title: 'First article', slug: 'author-draft', content: '<p>Body text</p>', categories: [ids.category], tags: [ids.tag], status: 'published', featured: true })
    .expect(200);
  assert.equal(upd.body.article.slug, 'author-draft-2');
  assert.equal(upd.body.article.status, 'published');

  const byCat = await request(app).get('/api/public/articles?category=technology').expect(200);
  assert.equal(byCat.body.total, 1);
  assert.equal(byCat.body.category.name, 'Technology');
  await request(app).get('/api/public/articles?category=missing').expect(404);

  const byTag = await request(app).get('/api/public/articles?tag=ai-tools').expect(200);
  assert.equal(byTag.body.total, 1);

  const home = await request(app).get('/api/public/home').expect(200);
  assert.equal(home.body.latest.length, 2);
  assert.equal(home.body.featured.length, 1);
  assert.equal(home.body.trendingTags[0].slug, 'ai-tools');

  const detail = await request(app).get('/api/public/articles/author-draft-2').expect(200);
  assert.ok(detail.body.previous || detail.body.next);
});

test('scheduling: requires a future time and publishes exactly once', async () => {
  const draft = await request(app).post('/api/admin/articles').set(as('editor')).send({ title: 'Scheduled piece', content: '<p>Later</p>' }).expect(201);
  const id = draft.body.article._id;
  await request(app).patch(`/api/admin/articles/${id}/status`).set(as('editor')).send({ status: 'scheduled' }).expect(400);
  await request(app).patch(`/api/admin/articles/${id}/status`).set(as('editor')).send({ status: 'scheduled', scheduledAt: new Date(Date.now() - 60000).toISOString() }).expect(400);
  const when = new Date(Date.now() + 3600000);
  const ok = await request(app).patch(`/api/admin/articles/${id}/status`).set(as('editor')).send({ status: 'scheduled', scheduledAt: when.toISOString() }).expect(200);
  assert.equal(ok.body.article.status, 'scheduled');

  assert.equal(await publishDueArticles(new Date()), 0, 'not due yet');
  const later = new Date(when.getTime() + 1000);
  const results = await Promise.all([publishDueArticles(later), publishDueArticles(later)]);
  assert.equal(results[0] + results[1], 1, 'published exactly once across concurrent runs');
  const doc = await Article.findById(id);
  assert.equal(doc.status, 'published');
  assert.equal(doc.history.filter((h) => h.action === 'status:scheduled->published').length, 1);
  await doc.deleteOne();
});

test('deleting a category detaches it from articles', async () => {
  await request(app).delete(`/api/admin/categories/${ids.category2}`).set(as('editor')).expect(204);
  await request(app).delete(`/api/admin/categories/${ids.category}`).set(as('editor')).expect(204);
  const a = await Article.findById(ids.article);
  assert.equal(a.categories.length, 0);
});

test('media upload: accepts real images, rejects disguised files', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const ok = await request(app).post('/api/admin/media').set(as('author')).attach('file', png, { filename: '../../evil.png', contentType: 'image/png' }).expect(201);
  uploaded.push(ok.body.item.filename);
  assert.match(ok.body.item.url, /^\/uploads\/\d+-[a-f0-9]{16}\.png$/);
  await request(app).get(ok.body.item.url).expect(200);

  await request(app).post('/api/admin/media').set(as('author')).attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'fake.png', contentType: 'image/png' }).expect(400);
  await request(app).post('/api/admin/media').set(as('author')).attach('file', Buffer.from('<svg/>'), { filename: 'x.svg', contentType: 'image/svg+xml' }).expect(400);
  await request(app).post('/api/admin/media').attach('file', png, { filename: 'a.png', contentType: 'image/png' }).expect(401);

  await request(app).delete(`/api/admin/media/${ok.body.item._id}`).set(as('editor')).expect(204);
});

test('settings: admin can update; public settings never leak internals', async () => {
  const body = { siteName: 'Test Blog', tagline: 'Hi', pages: { about: '<p>About</p><script>x</script>' }, postsPerPage: 6 };
  const res = await request(app).put('/api/admin/settings').set(as('admin')).send(body).expect(200);
  assert.equal(res.body.settings.siteName, 'Test Blog');
  assert.ok(!/script/.test(res.body.settings.pages.about));
  const pub = await request(app).get('/api/public/settings').expect(200);
  assert.equal(pub.body.settings.siteName, 'Test Blog');
  assert.equal(pub.body.settings._id, undefined);
});

test('users: admin manages accounts; last admin is protected; role change revokes tokens', async () => {
  await request(app).post('/api/admin/users').set(as('admin')).send({ name: 'New', email: 'new@example.test', password: 'short', role: 'author' }).expect(400);
  const created = await request(app).post('/api/admin/users').set(as('admin')).send({ name: 'New', email: 'new@example.test', password: 'long-enough-pw', role: 'author' }).expect(201);
  await request(app).post('/api/admin/users').set(as('admin')).send({ name: 'Dup', email: 'new@example.test', password: 'long-enough-pw', role: 'author' }).expect(409);
  await request(app).put(`/api/admin/users/${ids.admin}`).set(as('admin')).send({ name: 'Test admin', role: 'editor', active: true }).expect(400);
  await request(app).delete(`/api/admin/users/${ids.admin}`).set(as('admin')).expect(400);
  await request(app).delete(`/api/admin/users/${ids.author}`).set(as('admin')).expect(409); // has articles
  await request(app).delete(`/api/admin/users/${created.body.item.id}`).set(as('admin')).expect(204);

  await request(app).put(`/api/admin/users/${ids.author}`).set(as('admin')).send({ name: 'Test author', role: 'author', active: false }).expect(200);
  await request(app).get('/api/auth/me').set(as('author')).expect(401);
});

test('newsletter: validates email and is idempotent', async () => {
  await request(app).post('/api/public/newsletter').send({ email: 'nope' }).expect(400);
  await request(app).post('/api/public/newsletter').send({ email: 'Reader@Example.test' }).expect(201);
  await request(app).post('/api/public/newsletter').send({ email: 'reader@example.test' }).expect(201);
  const count = await request(app).get('/api/admin/subscribers/count').set(as('editor')).expect(200);
  assert.equal(count.body.subscribed, 1);
});

test('change password rotates the token; activity log records actions', async () => {
  await request(app).post('/api/auth/change-password').set(as('editor')).send({ currentPassword: 'wrong', newPassword: 'another-long-password' }).expect(400);
  const res = await request(app).post('/api/auth/change-password').set(as('editor')).send({ currentPassword: PASSWORD, newPassword: 'another-long-password' }).expect(200);
  await request(app).get('/api/auth/me').set(as('editor')).expect(401);
  await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`).expect(200);

  const log = await request(app).get('/api/admin/activity').set(as('admin')).expect(200);
  assert.ok(log.body.total > 10);
  assert.ok(log.body.items.some((i) => i.action === 'article.create'));
  const stats = await request(app).get('/api/admin/stats').set(as('admin')).expect(200);
  assert.equal(stats.body.published, 2);
  assert.equal(stats.body.manual, stats.body.total);
});

test('author profile: job title and links on the author page, posts and search data', async () => {
  // Its own account: earlier tests deactivate the shared "author" user.
  await User.create({ name: 'Profile author', email: 'profile@example.test', role: 'author', passwordHash: await bcrypt.hash(PASSWORD, 4) });
  const login = await request(app).post('/api/auth/login').send({ email: 'profile@example.test', password: PASSWORD }).expect(200);
  const me = { Authorization: `Bearer ${login.body.token}` };
  const authorId = String(login.body.user.id);
  await request(app).put('/api/auth/profile').set(me).send({ name: 'Test author', links: { linkedin: 'javascript:alert(1)' } }).expect(400);
  const saved = await request(app)
    .put('/api/auth/profile')
    .set(me)
    .send({ name: 'Dinesh Gola', bio: 'Blockchain developer who writes about AI.', avatarUrl: '', jobTitle: 'Blockchain & crypto developer', links: { linkedin: 'https://www.linkedin.com/in/example', github: 'https://github.com/example' } })
    .expect(200);
  assert.equal(saved.body.user.jobTitle, 'Blockchain & crypto developer');
  // An older admin page that sends only name/bio/photo keeps the other fields.
  await request(app).put('/api/auth/profile').set(me).send({ name: 'Dinesh Gola', bio: 'Blockchain developer who writes about AI.', avatarUrl: '' }).expect(200);
  const pub = await request(app).get(`/api/public/authors/${authorId}`).expect(200);
  assert.equal(pub.body.author.jobTitle, 'Blockchain & crypto developer');
  assert.equal(pub.body.author.links.github, 'https://github.com/example');
  assert.equal(pub.body.author.email, undefined, 'email is never public');
  const { renderHead, headToHtml } = await import('../src/services/seoService.js');
  const head = await renderHead(`/author/${authorId}`, 'https://blog.example.test');
  const page = head.ld.find((x) => x['@type'] === 'ProfilePage');
  assert.equal(page.mainEntity.name, 'Dinesh Gola');
  assert.equal(page.mainEntity.jobTitle, 'Blockchain & crypto developer');
  assert.deepEqual(page.mainEntity.sameAs, ['https://www.linkedin.com/in/example', 'https://github.com/example']);
  assert.match(headToHtml(head, 'Test Blog'), /og:type" content="profile"/);
});

test('wording clean-up removes stock AI phrases without touching links, citations or numbers', async () => {
  const { polishWording, findAiPhrases } = await import('../src/utils/writingQuality.js');
  const html =
    '<p>In today\'s fast-paced world, firms utilize AI. It\'s important to note that 42% of firms <a href="/blog/delve-into-data">delve into</a> data [F1].</p>' +
    '<p>Moreover, this seamless tool plays a crucial role in growth — it will revolutionize work — fast — really.</p><h2>In conclusion, what to do</h2><p>Margin traders use leverage.</p>';
  const { html: out, changes } = polishWording(html);
  assert.ok(changes > 0);
  assert.deepEqual(findAiPhrases(out.replace(/<[^>]+>/g, ' ')), []);
  assert.match(out, /<p>Firms use AI\. 42% of firms <a href="\/blog\/delve-into-data">look at<\/a> data \[F1\]\.<\/p>/);
  assert.match(out, /Also, this smooth tool is central to growth/);
  assert.match(out, /<h2>What to do<\/h2>/);
  assert.match(out, /Margin traders use leverage\./, 'real terms such as trading leverage are kept');
  assert.equal((out.match(/—/g) || []).length, 1, 'em dashes limited');
  assert.equal(polishWording('<p>Moreover, x</p>', 'Hindi').html, '<p>Moreover, x</p>', 'other languages untouched');
});

test('photo search: old scans, film pictures and loose matches are skipped', async () => {
  const { photoFits } = await import('../src/services/images/imageService.js');
  const open = (title, keywords = '') => ({ open: true, alt: '', keywords, credit: { title } });
  const survey = open("Mahlon Wright's draft of 86 acres (survey of land owned by Mahlon Wright on Doctors Creek) (NYPL b19605260)");
  assert.equal(photoFits(survey, 'doctor tablet clinic'), false, 'archive scan');
  assert.equal(photoFits(open('Justice League Review!'), 'executive reviewing financial charts laptop'), false, 'film picture');
  assert.equal(photoFits(open('Team meeting review', 'meeting'), 'executive reviewing financial charts laptop'), false, 'only a generic word in common');
  assert.equal(photoFits(open('Laptop showing sales charts', 'finance office'), 'executive reviewing financial charts laptop'), true);
  assert.equal(photoFits({ open: false, alt: 'Woman at a desk', credit: { title: '' } }, 'executive reviewing financial charts laptop'), true, 'curated libraries are trusted');
  assert.equal(photoFits({ open: false, alt: 'Vintage movie poster', credit: {} }, 'cinema'), false, 'unsuitable everywhere');
});

test('post previews leave out citation numbers; old previews are cleaned once', async () => {
  const { excerptFrom } = await import('../src/utils/content.js');
  const { cleanExcerpts } = await import('../src/scripts/migrations.js');
  assert.equal(excerptFrom('The tech world held its breath. [1] Sales rose 9% [2, 3].'), 'The tech world held its breath. Sales rose 9%.');
  const a = await Article.create({ title: 'Preview cleanup', slug: 'preview-cleanup', author: ids.admin, content: '<p>x</p>', excerpt: 'The world held its breath. [1] The headline was simple [2][3].' });
  assert.equal(await cleanExcerpts(), 1);
  assert.equal((await Article.findById(a._id).lean()).excerpt, 'The world held its breath. The headline was simple.');
  assert.equal(await cleanExcerpts(), 0, 'runs once');
  await Article.deleteOne({ _id: a._id });
});

test('categories: default topics are added once and posts are filed by topic', async () => {
  const { guessCategorySlugs, setUpCategories } = await import('../src/services/categories.js');
  const { SiteSettings, Category } = await import('../src/models/index.js');
  assert.deepEqual(guessCategorySlugs({ title: 'How to Secure Home Wi-Fi: Simple Steps', keyword: 'secure home wifi' }), ['cybersecurity', 'guides']);
  assert.deepEqual(guessCategorySlugs({ title: 'Bitcoin ETF inflows hit record as crypto rallies' }), ['blockchain-crypto']);
  assert.deepEqual(guessCategorySlugs({ title: 'Nvidia CEO steps down', keyword: 'Nvidia CEO exit', text: 'AI chips' }), ['ai-news']);
  assert.deepEqual(guessCategorySlugs({ title: '5 steps to protect your passwords from hackers' }), ['cybersecurity', 'guides'], 'guide wording still counts');
  assert.deepEqual(guessCategorySlugs({ title: 'A quiet afternoon' }), ['technology']);
  assert.deepEqual(guessCategorySlugs({ title: 'Samsung Galaxy S26 review: the best Android phone this year' }), ['gadgets-devices']);
  assert.deepEqual(guessCategorySlugs({ title: 'SpaceX Starship completes orbital test flight' }), ['space-science']);
  assert.deepEqual(guessCategorySlugs({ title: 'Tesla robotaxi rollout expands to three new cities' }), ['ev-mobility']);
  assert.deepEqual(guessCategorySlugs({ title: 'AWS outage takes down thousands of websites', text: 'cloud servers and data centers' }), ['cloud-data']);
  assert.deepEqual(guessCategorySlugs({ title: 'Python 3.14 release: what developers need to know' }), ['programming']);
  assert.deepEqual(guessCategorySlugs({ title: 'WhatsApp adds new privacy features to its app' }), ['apps-software']);

  await SiteSettings.getSingleton();
  await SiteSettings.updateOne({ key: 'site' }, { $pull: { setupDone: { $in: ['categories-v1', 'categories-v2'] } } });
  const post = await Article.create({ title: 'AI chatbots for small business customer support', slug: 'category-test', author: ids.admin, content: '<p>Small businesses use chatbots for customer support and sales.</p>', contentText: 'Small businesses use chatbots for customer support and sales.' });
  assert.equal(await setUpCategories(), true);
  for (const slug of ['ai-news', 'ai-in-business', 'cybersecurity', 'blockchain-crypto', 'gadgets-devices', 'apps-software', 'cloud-data', 'programming', 'space-science', 'ev-mobility', 'guides', 'technology']) assert.ok(await Category.exists({ slug }), slug);
  const filed = await Article.findById(post._id).populate('categories', 'slug').lean();
  assert.deepEqual(filed.categories.map((c) => c.slug), ['ai-in-business']);
  assert.equal(await setUpCategories(), false, 'runs once');
  await Article.deleteOne({ _id: post._id });
});

test('unknown routes return JSON 404', async () => {
  const res = await request(app).get('/api/nope').expect(404);
  assert.ok(res.body.error);
});
