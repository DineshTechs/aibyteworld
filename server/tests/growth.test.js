// Growth features: auto-sharing, IndexNow, internal links, newsletter,
// Hindi versions, evergreen Autopilot posts, post refreshes and photo
// optimisation. Every outside service is simulated by replacing fetch.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
const { env } = await import('../src/config/env.js');
env.DB_NAME = `${env.DB_NAME}_test`;
if (!env.SECRETS_KEY) env.SECRETS_KEY = crypto.randomBytes(32).toString('hex');
env.GEMINI_API_KEY = '';

const { default: mongoose } = await import('mongoose');
const { default: bcrypt } = await import('bcryptjs');
const { default: request } = await import('supertest');
const { default: fs } = await import('node:fs');
const { default: path } = await import('node:path');
const { connectDb, disconnectDb } = await import('../src/config/db.js');
const { createApp } = await import('../src/app.js');
const { signToken } = await import('../src/middleware/auth.js');
const models = await import('../src/models/index.js');
const { AIProvider, Article, ArticleStat, Growth, Media, NewsletterSubscriber, ResearchJob, SiteSettings, TelegramBot, Translation, User } = models;
const { settleHooks } = await import('../src/services/publishHooks.js');
const { publicBase } = await import('../src/services/growth/common.js');
const share = await import('../src/services/growth/share.js');
const indexnow = await import('../src/services/growth/indexnow.js');
const links = await import('../src/services/seo/internalLinks.js');
const newsletter = await import('../src/services/newsletter/newsletterService.js');
const translator = await import('../src/services/translate/translator.js');
const { translateNext } = await import('../src/jobs/growthScheduler.js');
const { slotKind, localDayStart } = await import('../src/services/autopilot/schedule.js');
const { startAutopilotPost, nextKind } = await import('../src/services/autopilot/runner.js');
const refresh = await import('../src/services/refresh/refreshService.js');
const optimize = await import('../src/services/images/optimize.js');
const { renderHead, headToHtml, buildSitemap } = await import('../src/services/seoService.js');
const bot = await import('../src/services/telegram/bot.js');
const { resetAllHealth } = await import('../src/services/ai/health.js');
const { dayKey } = await import('../src/services/analyticsService.js');

const app = createApp();
const tokens = {};
const users = {};
const as = (role) => ({ Authorization: `Bearer ${tokens[role]}` });
const SITE = 'https://blog.example.com';
const TG_TOKEN = '123456789:AAFakeTokenForTestsOnly_abcdefghijklmn';
const KEYS = { groq: 'gsk_FAKE-groq-key-123456', tavily: 'tvly-FAKE-key-1234567890', brevo: 'xkeysib-FAKE-brevo-key-1234', li: 'AQV-FAKE-linkedin-token-9876', fb: 'EAAG-FAKE-facebook-token-5555' };
const X = { apiKey: 'x-consumer-key-1111', apiSecret: 'x-consumer-secret-2222', accessToken: '1234-x-access-token-3333', accessSecret: 'x-access-secret-4444' };

// ---------- Simulated services ----------
const realFetch = globalThis.fetch;
const sim = { calls: [], telegram: [], emails: [], tweets: [], linkedin: [], facebook: [], indexnow: [], translateMode: 'good', xFail: false };
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

// A pretend Hindi translation: every English word becomes "शब्द"; tags, placeholders and numbers stay.
const hindi = (html) => String(html).split(/(<[^>]+>|\[\[C\d+\]\])/).map((p, i) => (i % 2 ? p : p.replace(/[A-Za-z]+/g, 'शब्द'))).join('');

function chatAnswer(system, prompt) {
  if (system.includes('Hindi translator')) {
    if (prompt.includes('Return JSON')) {
      const data = JSON.parse(prompt.match(/<block>\n([\s\S]*?)\n<\/block>/)[1]);
      return JSON.stringify(Object.fromEntries(Object.entries(data).map(([k, v]) => [k, hindi(v)])));
    }
    const blocks = [...prompt.matchAll(/<<<B(\d+)>>>\n([\s\S]*?)(?=\n<<<B\d+>>>|$)/g)];
    return blocks.map(([, id, html], i) => `<<<B${id}>>>\n${hindi(html)}${sim.translateMode === 'badNumber' && i === 0 ? ' 99' : ''}`).join('\n');
  }
  if (system.includes('You plan evergreen articles')) {
    sim.calls.push('evergreen');
    const given = (prompt.match(/chosen by the site owner: "([^"]+)"/) || [])[1];
    return JSON.stringify({ topic: given || 'How to choose a laptop for coding', primaryKeyword: 'laptop for coding', secondaryKeywords: ['programming laptop'], audience: 'Students', angle: 'Explains what matters. Helps buyers.', trend: 'ignored' });
  }
  return '';
}

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  let body = {};
  try {
    body = init.body ? JSON.parse(init.body) : {};
  } catch {
    body = Object.fromEntries(new URLSearchParams(String(init.body)));
  }
  const h = init.headers || {};
  if (u.startsWith('https://api.telegram.org/bot')) {
    const [, token, method] = u.match(/bot([^/]+)\/(\w+)$/);
    if (token !== TG_TOKEN) return json(401, { ok: false, description: 'Unauthorized' });
    sim.telegram.push({ method, ...body });
    if (method === 'getMe') return json(200, { ok: true, result: { id: 42, is_bot: true, username: 'blog_test_bot' } });
    if (method === 'getChat') return json(200, { ok: true, result: { id: -1001234567890, title: 'Blog News', type: 'channel' } });
    if (method === 'getChatMember') return json(200, { ok: true, result: { status: 'administrator', can_post_messages: true } });
    return json(200, { ok: true, result: { message_id: sim.telegram.length } });
  }
  if (u.startsWith('https://api.groq.com/openai/v1/')) {
    if (h.Authorization !== `Bearer ${KEYS.groq}`) return json(401, { error: { message: 'Invalid API Key' } });
    if (u.endsWith('/models')) return json(200, { data: [{ id: 'llama-test', active: true }] });
    const system = body.messages.find((m) => m.role === 'system')?.content || '';
    const prompt = body.messages.find((m) => m.role === 'user')?.content || '';
    return json(200, { choices: [{ message: { content: chatAnswer(system, prompt) }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10 } });
  }
  if (u === 'https://api.tavily.com/search') {
    if (h.Authorization !== `Bearer ${KEYS.tavily}`) return json(401, { detail: { error: 'Unauthorized' } });
    sim.calls.push('tavily');
    return json(200, { results: [{ title: 'The complete guide to picking a laptop', url: 'https://hints.example.test/a', content: 'x', score: 0.9 }] });
  }
  if (u === 'https://api.brevo.com/v3/smtp/email') {
    if (h['api-key'] !== KEYS.brevo) return json(401, { code: 'unauthorized', message: 'Key not found' });
    sim.emails.push(body);
    return json(201, { messageId: `<m${sim.emails.length}@brevo>` });
  }
  if (u === 'https://api.x.com/2/tweets') {
    assert.match(h.Authorization, /^OAuth .*oauth_consumer_key="x-consumer-key-1111".*oauth_signature="[^"]+"/);
    if (sim.xFail) return json(403, { title: 'Forbidden', detail: 'You are not permitted to perform this action.' });
    sim.tweets.push(body);
    return json(201, { data: { id: `t${sim.tweets.length}`, text: body.text } });
  }
  if (u === 'https://api.x.com/2/users/me') return json(200, { data: { id: '1', username: 'blogtest' } });
  if (u === 'https://api.linkedin.com/rest/posts') {
    if (h.Authorization !== `Bearer ${KEYS.li}`) return json(401, { message: 'Invalid access token' });
    assert.match(h['LinkedIn-Version'], /^\d{6}$/);
    sim.linkedin.push(body);
    return new Response(null, { status: 201, headers: { 'x-restli-id': `urn:li:share:${sim.linkedin.length}` } });
  }
  if (u === 'https://api.linkedin.com/v2/userinfo') return json(200, { sub: 'abc123', name: 'Asha Rao' });
  if (u.startsWith('https://graph.facebook.com/')) {
    if (u.endsWith('/feed')) {
      if (body.access_token !== KEYS.fb) return json(400, { error: { message: 'Invalid OAuth access token.' } });
      sim.facebook.push(body);
      return json(200, { id: `999_${sim.facebook.length}` });
    }
    return json(200, { id: '1234567', name: 'Blog Page' });
  }
  if (u === 'https://api.indexnow.org/indexnow') {
    sim.indexnow.push(body);
    return new Response(null, { status: 202 });
  }
  return realFetch(url, init);
};

async function dropTestCollections() {
  assert.match(mongoose.connection.name, /_test$/, 'tests must use a *_test database');
  for (const m of Object.values(mongoose.models)) await m.collection.drop().catch(() => {});
}

before(async () => {
  await connectDb();
  await dropTestCollections();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  const passwordHash = await bcrypt.hash('test-password-123', 4);
  for (const role of ['admin', 'editor', 'author']) {
    users[role] = await User.create({ name: `Growth ${role}`, email: `growth-${role}@example.test`, role, passwordHash });
    tokens[role] = signToken(users[role]);
  }
  await SiteSettings.getSingleton();
  await AIProvider.create([{ key: 'openverse', enabled: false }, { key: 'wikimedia', enabled: false }, { key: 'nasa', enabled: false }]);
  // Free providers: Groq writes, Tavily searches.
  await request(app).put('/api/admin/ai/providers/groq').set(as('admin')).send({ apiKey: KEYS.groq }).expect(200);
  await request(app).put('/api/admin/ai/providers/groq').set(as('admin')).send({ model: 'llama-test' }).expect(200);
  await request(app).put('/api/admin/ai/providers/tavily').set(as('admin')).send({ apiKey: KEYS.tavily }).expect(200);
  const s = await SiteSettings.getSingleton();
  await request(app).put('/api/admin/ai/settings').set(as('admin')).send({ ...s.toObject().ai, dailyJobLimit: 200, researchProviders: ['tavily'], writerProviders: ['groq'] }).expect(200);
  // Translations are tested on their own; keep them off elsewhere.
  await Growth.getSingleton();
  await Growth.updateOne({ key: 'growth' }, { $set: { 'translation.hindi': false } });
});

after(async () => {
  globalThis.fetch = realFetch;
  await settleHooks();
  await dropTestCollections();
  await disconnectDb();
});

beforeEach(async () => {
  await resetAllHealth();
  Object.assign(sim, { calls: [], telegram: [], emails: [], tweets: [], linkedin: [], facebook: [], indexnow: [], translateMode: 'good', xFail: false });
  indexnow._test.reset();
});

const setSiteUrl = (siteUrl) => SiteSettings.updateOne({ key: 'site' }, { $set: { siteUrl } });
let n = 0;
async function publish(fields = {}) {
  n += 1;
  const res = await request(app)
    .post('/api/admin/articles')
    .set(as('admin'))
    .send({ title: `Post number ${n}`, content: `<h2>Intro</h2><p>Some text about phones and laptops ${n}.</p>`, status: 'published', seo: { title: '', description: '', focusKeyword: '', canonicalUrl: '', noindex: false }, ...fields })
    .expect(201);
  await settleHooks();
  return Article.findById(res.body.article._id);
}

// ---------- Tests ----------
test('public address check: links to this computer are never shared or sent', () => {
  assert.equal(publicBase(''), '');
  assert.equal(publicBase('http://localhost:5173'), '');
  assert.equal(publicBase('http://127.0.0.1:5000'), '');
  assert.equal(publicBase('http://192.168.1.20'), '');
  assert.equal(publicBase('https://myblog.test'), '');
  assert.equal(publicBase('https://blog.example.com/'), 'https://blog.example.com');
  assert.equal(publicBase('https://example.com/news/'), 'https://example.com/news');
});

test('X sign-in signature matches the published OAuth 1.0a example', () => {
  const header = share.oauth1Header({
    method: 'POST',
    url: 'https://api.twitter.com/1.1/statuses/update.json?include_entities=true',
    consumerKey: 'xvz1evFS4wEEPTGEFPHBog',
    consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
    token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
    tokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
    params: { status: 'Hello Ladies + Gentlemen, a signed OAuth request!' },
    nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
    timestamp: 1318622958,
  });
  assert.match(header, /oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"/);
  assert.equal(share.linkedinVersion('', new Date('2026-11-18T00:00:00Z')), '202609');
  assert.equal(share.linkedinVersion('202510'), '202510');
  const text = share.xText({ title: 'A'.repeat(400) }, 'https://blog.example.com/blog/x', ['AiTools', 'Tech']);
  assert.ok(text.length - 'https://blog.example.com/blog/x'.length + 23 <= 280, 'fits in a post');
  assert.deepEqual(share.hashtags({ tags: [{ name: 'AI tools' }, { name: 'c' }, { name: 'gadgets & phones' }] }, 3), ['AITools', 'GadgetsPhones']);
  assert.equal(share.linkedinText({ title: 'Hello (world)', excerpt: '' }, ['Ai']), 'Hello \\(world\\)\n\n{hashtag|\\#|Ai}');
});

test('auto-share: each new post goes once to the Telegram channel, X, LinkedIn and Facebook; keys are never returned', async () => {
  await request(app).put('/api/admin/telegram').set(as('admin')).send({ token: TG_TOKEN }).expect(200);
  const body = {
    share: {
      telegram: { enabled: true, channel: '@blognews' },
      x: { enabled: true, ...X },
      linkedin: { enabled: true, token: KEYS.li, author: '', version: '' },
      facebook: { enabled: true, pageId: '1234567', token: KEYS.fb },
      hashtags: 2,
    },
  };
  await request(app).put('/api/admin/growth').set(as('editor')).send(body).expect(403);
  await request(app).put('/api/admin/growth').set(as('admin')).send({ share: { ...body.share, telegram: { enabled: true, channel: 'blog news' } } }).expect(400);
  const saved = await request(app).put('/api/admin/growth').set(as('admin')).send(body).expect(200);
  const text = JSON.stringify(saved.body);
  for (const secret of [...Object.values(X), KEYS.li, KEYS.fb]) assert.ok(!text.includes(secret), 'secrets never leave the server');
  assert.equal(saved.body.share.x.ready, true);
  assert.equal(saved.body.share.linkedin.last4, '9876');
  const raw = await Growth.findOne({ key: 'growth' }).select('+share.x.apiKey.data').lean();
  assert.ok(raw.share.x.apiKey.data && !raw.share.x.apiKey.data.includes('x-consumer'), 'stored encrypted');

  // Checks never post anything.
  const tgCheck = await request(app).post('/api/admin/growth/check/telegram').set(as('admin')).expect(200);
  assert.equal(tgCheck.body.ok, true, tgCheck.body.message);
  const liCheck = await request(app).post('/api/admin/growth/check/linkedin').set(as('admin')).expect(200);
  assert.match(liCheck.body.message, /Asha Rao/);
  assert.equal(liCheck.body.growth.share.linkedin.author, 'urn:li:person:abc123');
  assert.equal((await request(app).post('/api/admin/growth/check/x').set(as('admin')).expect(200)).body.ok, true);
  assert.equal((await request(app).post('/api/admin/growth/check/facebook').set(as('admin')).expect(200)).body.ok, true);
  assert.equal(sim.tweets.length + sim.linkedin.length + sim.facebook.length, 0);

  // While the site runs on this computer nothing is shared.
  await setSiteUrl('http://localhost:5173');
  const local = await publish({ title: 'Local only post' });
  assert.equal(sim.tweets.length, 0);
  assert.deepEqual(local.shares, []);
  assert.match((await Growth.getSingleton()).share.lastSkipped, /not a public web address/);

  await setSiteUrl(SITE);
  sim.telegram = [];
  const tag = (await request(app).post('/api/admin/tags').set(as('admin')).send({ name: 'AI tools' }).expect(201)).body.item;
  const a = await publish({ title: 'Best phones for students', tags: [tag._id], excerpt: 'Our picks for every budget.', featuredImage: { url: '/uploads/cover.jpg', alt: 'Phones' } });
  assert.equal(sim.tweets.length, 1);
  assert.match(sim.tweets[0].text, /Best phones for students\n\nhttps:\/\/blog\.example\.com\/blog\/best-phones-for-students\n\n#AITools/);
  assert.equal(sim.linkedin.length, 1);
  assert.equal(sim.linkedin[0].author, 'urn:li:person:abc123');
  assert.equal(sim.linkedin[0].content.article.source, `${SITE}/blog/${a.slug}`);
  assert.equal(sim.facebook.length, 1);
  assert.equal(sim.facebook[0].link, `${SITE}/blog/${a.slug}`);
  const photo = sim.telegram.find((m) => m.method === 'sendPhoto');
  assert.equal(photo.chat_id, '@blognews');
  assert.equal(photo.photo, `${SITE}/uploads/cover.jpg`);
  assert.match(photo.caption, /<b>Best phones for students<\/b>[\s\S]*Read the full post/);
  assert.deepEqual(a.shares.map((x) => [x.channel, x.ok]).sort(), [['facebook', true], ['linkedin', true], ['telegram', true], ['x', true]]);

  // Editing the published post never shares it again.
  await request(app).put(`/api/admin/articles/${a._id}`).set(as('admin')).send({ title: a.title, content: `${a.content}<p>More.</p>`, featuredImage: a.featuredImage, tags: [tag._id], status: 'published' }).expect(200);
  await settleHooks();
  assert.equal(sim.tweets.length, 1);

  // A failed channel is recorded and can be retried by hand; the others are not repeated.
  sim.xFail = true;
  const b = await publish({ title: 'Second phone guide' });
  assert.equal(b.shares.find((x) => x.channel === 'x').ok, false);
  assert.match(b.shares.find((x) => x.channel === 'x').error, /not permitted/);
  assert.match((await Growth.getSingleton()).share.x.lastError, /not permitted/);
  sim.xFail = false;
  const retry = await request(app).post(`/api/admin/articles/${b._id}/share`).set(as('editor')).expect(200);
  assert.equal(retry.body.results.x.ok, true);
  assert.equal(retry.body.results.linkedin.skipped, 'already shared');
  assert.equal(sim.linkedin.length, 2, 'LinkedIn was not posted twice');

  // Removing a key turns the channel off.
  const off = await request(app).delete('/api/admin/growth/keys/x').set(as('admin')).expect(200);
  assert.equal(off.body.share.x.enabled, false);
  assert.equal(off.body.share.x.has.apiKey, false);
  await request(app).put('/api/admin/growth').set(as('admin')).send({ share: { telegram: { enabled: false, channel: '' }, linkedin: { enabled: false, author: '', version: '' }, facebook: { enabled: false, pageId: '' } } }).expect(200);
});

test('IndexNow: search engines are told about new, changed and removed posts; the key file proves ownership', async () => {
  await setSiteUrl(SITE);
  const g = await Growth.getSingleton();
  assert.match(g.indexnow.key, /^[a-f0-9]{32}$/);
  const keyFile = await request(app).get(`/${g.indexnow.key}.txt`).expect(200);
  assert.equal(keyFile.text, g.indexnow.key);
  await request(app).get(`/${'0'.repeat(32)}.txt`).expect(404);

  const a = await publish({ title: 'IndexNow test post' });
  const ping = sim.indexnow.find((p) => p.urlList.includes(`${SITE}/blog/${a.slug}`));
  assert.ok(ping, JSON.stringify(sim.indexnow));
  assert.equal(ping.host, 'blog.example.com');
  assert.equal(ping.keyLocation, `${SITE}/${g.indexnow.key}.txt`);
  assert.match((await Growth.getSingleton()).indexnow.lastResult, /^Sent/);

  // Autosaves within a few minutes do not ping again; unpublishing always does.
  sim.indexnow = [];
  await request(app).put(`/api/admin/articles/${a._id}?autosave=1`).set(as('admin')).send({ title: a.title, content: `${a.content}<p>x</p>`, status: 'published' }).expect(200);
  await settleHooks();
  assert.equal(sim.indexnow.length, 0);
  await request(app).patch(`/api/admin/articles/${a._id}/status`).set(as('admin')).send({ status: 'archived' }).expect(200);
  await settleHooks();
  assert.equal(sim.indexnow.length, 1);

  const manual = await request(app).post('/api/admin/growth/indexnow').set(as('admin')).expect(200);
  assert.equal(manual.body.result.ok, true);
  await request(app).put('/api/admin/growth').set(as('admin')).send({ indexnow: { enabled: false } }).expect(200);
  await request(app).get(`/${g.indexnow.key}.txt`).expect(404);
  await request(app).put('/api/admin/growth').set(as('admin')).send({ indexnow: { enabled: true } }).expect(200);
});

test('internal links: exact keyword phrases link to related posts, never inside headings or links; older posts link to new ones', async () => {
  const html = '<h2>Budget phones guide</h2><p>See our <a href="/x">budget phones guide</a> first.</p><p>A budget phones guide helps. Budget phones guide again.</p><figure><figcaption>budget phones guide</figcaption></figure>';
  const out = links.addLinks(html, [{ slug: 'budget-phones', phrases: ['budget phones guide'] }], 3);
  assert.equal(out.added.length, 1);
  assert.equal(out.html, '<h2>Budget phones guide</h2><p>See our <a href="/x">budget phones guide</a> first.</p><p>A <a href="/blog/budget-phones">budget phones guide</a> helps. Budget phones guide again.</p><figure><figcaption>budget phones guide</figcaption></figure>');
  assert.equal(links.addLinks(out.html, [{ slug: 'budget-phones', phrases: ['budget phones guide'] }], 3).added.length, 0, 'never twice to the same post');
  assert.deepEqual(links.phrasesFor({ seo: { focusKeyword: 'AI', secondaryKeywords: ['noise cancelling headphones', 'Noise Cancelling Headphones'] } }), ['noise cancelling headphones']);

  const old = await publish({ title: 'Commuting tips', content: '<p>Many riders swear by noise cancelling headphones on the train.</p>' });
  const fresh = await publish({ title: 'Best noise cancelling headphones', seo: { title: '', description: '', focusKeyword: 'noise cancelling headphones', canonicalUrl: '', noindex: false } });
  const updated = await Article.findById(old._id);
  assert.match(updated.content, new RegExp(`<a href="/blog/${fresh.slug}">noise cancelling headphones</a>`));
  assert.ok(updated.history.some((h) => /added automatically/.test(h.note)));
  const linked = await links.linkNewContent('<p>Pack noise cancelling headphones for flights.</p>', { excludeIds: [] });
  assert.equal(linked.added[0].slug, fresh.slug);
});

test('newsletter: confirmation email, weekly digest with unsubscribe links, and subscriber export', async () => {
  await setSiteUrl(SITE);
  // Without an email provider, signups are confirmed straight away (as before).
  let r = await request(app).post('/api/public/newsletter').send({ email: 'First@Example.test' }).expect(201);
  assert.equal(r.body.confirm, false);
  assert.equal((await NewsletterSubscriber.findOne({ email: 'first@example.test' })).status, 'subscribed');

  const cfg = { provider: 'brevo', apiKey: KEYS.brevo, fromEmail: 'news@example.com', fromName: 'Blog', replyTo: '', doubleOptIn: true, digest: { enabled: true, day: 3, time: '10:00', maxPosts: 5 } };
  const v = await request(app).put('/api/admin/growth').set(as('admin')).send({ newsletter: cfg }).expect(200);
  assert.equal(v.body.newsletter.ready, true);
  assert.ok(!JSON.stringify(v.body).includes(KEYS.brevo));

  r = await request(app).post('/api/public/newsletter').send({ email: 'reader@example.test' }).expect(201);
  assert.equal(r.body.confirm, true);
  assert.equal((await NewsletterSubscriber.findOne({ email: 'reader@example.test' })).status, 'pending');
  assert.equal(sim.emails.length, 1);
  const token = sim.emails[0].htmlContent.match(/newsletter\?confirm=([A-Za-z0-9_-]+)/)[1];
  await request(app).post('/api/public/newsletter/confirm').send({ token: 'wrong' }).expect(400);
  await request(app).post('/api/public/newsletter/confirm').send({ token }).expect(200);
  assert.equal((await NewsletterSubscriber.findOne({ email: 'reader@example.test' })).status, 'subscribed');
  await request(app).post('/api/public/newsletter/confirm').send({ token }).expect(400, /invalid or has expired/);

  // Weekly digest: newest posts, one email per subscriber, each with its own unsubscribe link.
  await publish({ title: 'Digest post one', excerpt: 'First summary' });
  sim.emails = [];
  const sent = await request(app).post('/api/admin/newsletter/send').set(as('admin')).send({}).expect(200);
  assert.equal(sent.body.sent, 2);
  assert.equal(sim.emails.length, 2);
  const mail = sim.emails.find((m) => m.to[0].email === 'reader@example.test');
  assert.match(mail.subject, /Digest post one/);
  assert.match(mail.htmlContent, /utm_source=newsletter/);
  assert.match(mail.headers['List-Unsubscribe'], /^<https:\/\/blog\.example\.com\/api\/public\/newsletter\/unsubscribe\?e=reader%40example\.test&t=/);
  assert.equal(mail.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  const t = newsletter.unsubscribeToken('reader@example.test');
  await request(app).post('/api/public/newsletter/unsubscribe').send({ e: 'reader@example.test', t: 'bad' }).expect(400);
  await request(app).post(`/api/public/newsletter/unsubscribe?e=reader%40example.test&t=${t}`).type('form').send('List-Unsubscribe=One-Click').expect(200);
  assert.equal((await NewsletterSubscriber.findOne({ email: 'reader@example.test' })).status, 'unsubscribed');

  // The scheduled digest goes out once on the chosen day after the chosen time (India time).
  sim.emails = [];
  await SiteSettings.updateOne({ key: 'site' }, { $set: { 'autopilot.timezone': 'Asia/Kolkata' } });
  assert.equal(await newsletter.digestTick(new Date('2026-11-18T03:00:00Z')), null, 'Wednesday 08:30 IST: too early');
  const first = await newsletter.digestTick(new Date('2026-11-18T05:00:00Z'));
  assert.equal(first.sent, 1);
  assert.equal(await newsletter.digestTick(new Date('2026-11-18T06:00:00Z')), null, 'only once that day');
  assert.equal(await newsletter.digestTick(new Date('2026-11-19T05:00:00Z')), null, 'not on Thursday');

  // Export: spreadsheet formulas are neutralised.
  await NewsletterSubscriber.create({ email: '=cmd@example.test', status: 'subscribed' });
  const csv = await request(app).get('/api/admin/newsletter/subscribers.csv').set(as('admin')).expect(200);
  assert.match(csv.text, /"'=cmd@example\.test","subscribed"/);
  await request(app).get('/api/admin/newsletter/subscribers.csv').set(as('editor')).expect(403);
  const list = await request(app).get('/api/admin/newsletter/subscribers?status=subscribed').set(as('editor')).expect(200);
  assert.equal(list.body.total, 2);
  const test2 = await request(app).post('/api/admin/newsletter/test').set(as('admin')).expect(200);
  assert.match(test2.body.message, /growth-admin@example\.test/);
  assert.match(sim.emails.at(-1).subject, /^\[Test\]/);
});

test('Hindi versions: structure, links, citations and numbers are kept; published with hreflang when the original is published', async () => {
  // Building blocks.
  const html = '<p>Phones cost $30 in 2025.<sup><a href="https://src.example/a" target="_blank" rel="noopener noreferrer" title="Src">[1]</a></sup></p><ul><li>One <a href="/blog/x">link</a></li><li>Two</li></ul>stray<hr /><figure><img src="/u.jpg" alt="x" /></figure>';
  const blocks = translator.splitBlocks(html);
  assert.equal(blocks.length, 5);
  assert.equal(blocks.join(''), html);
  const store = [];
  const p = translator.protect(blocks[0], store);
  assert.equal(p, '<p>Phones cost $30 in 2025.[[C1]]</p>');
  assert.equal(translator.restore(p, store), blocks[0]);
  assert.equal(translator.checkBlock(p, '<p>फोन की कीमत $30 है, 2025 में।[[C1]]</p>'), '');
  assert.equal(translator.checkBlock(p, '<p>फोन की कीमत $35 है, 2025 में।[[C1]]</p>'), 'the numbers changed');
  assert.equal(translator.checkBlock(p, '<p>फोन की कीमत $30 है, 2025 में।</p>'), 'links or citations changed');
  assert.equal(translator.checkBlock(p, '<p>फोन <b>$30</b> 2025[[C1]]</p>'), 'the HTML tags changed');
  assert.deepEqual(translator.numbersOf('२०२५ में 1,500 रुपये'), ['1500', '2025']);

  // The search index never treats "language" as its search language (MongoDB has no Hindi stemming).
  const textIndex = (await Article.collection.indexes()).find((i) => i.name === 'article_text');
  assert.equal(textIndex.language_override, 'textSearchLanguage');
  // An old-style index (as on sites set up before this version) is replaced at start-up.
  const { dropOutdatedIndexes } = await import('../src/config/db.js');
  assert.equal(await dropOutdatedIndexes(), false, 'nothing to rebuild');
  await Article.collection.dropIndex('article_text');
  await Article.collection.createIndex({ title: 'text', excerpt: 'text', contentText: 'text' }, { name: 'article_text', weights: { title: 10, excerpt: 4, contentText: 1 } });
  await assert.rejects(() => Article.init().then(() => Article.createIndexes()), /different options|IndexOptionsConflict/);
  assert.equal(await dropOutdatedIndexes(), true);
  await Article.createIndexes();
  assert.equal((await Article.collection.indexes()).find((i) => i.name === 'article_text').language_override, 'textSearchLanguage');
  await setSiteUrl(SITE);
  await Growth.updateOne({ key: 'growth' }, { $set: { 'translation.hindi': true, 'translation.autoPublish': true } });
  const src = await publish({
    title: 'Top 5 phones in 2026',
    excerpt: 'Five phones worth buying.',
    content: '<h2>Why it matters</h2><p>About 42 percent of buyers want 5G.<sup><a href="https://src.example/a" target="_blank" rel="noopener noreferrer">[1]</a></sup></p><h2>Frequently asked questions</h2><h3>Is 5G worth it?</h3><p>Yes, for most people in 2026.</p><h2>Sources</h2><ol><li><a href="https://src.example/a">Phone survey 2026</a></li></ol>',
    seo: { title: 'Top 5 phones in 2026', description: 'Five phones worth buying this year.', focusKeyword: 'best phones', canonicalUrl: '', noindex: false },
  });
  assert.equal(await Translation.countDocuments({ source: src._id, status: 'queued' }), 1, 'queued automatically after publishing');
  assert.equal(await translateNext(), true);
  const task = await Translation.findOne({ source: src._id });
  assert.equal(task.status, 'completed', task.error);
  const hi = await Article.findById(task.article);
  assert.equal(hi.language, 'hi');
  assert.equal(String(hi.translationOf), String(src._id));
  assert.equal(hi.slug, `${src.slug}-hi`);
  assert.equal(hi.status, 'published');
  assert.match(hi.title, /^शब्द 5 शब्द शब्द 2026$/);
  assert.match(hi.content, /<h2>अक्सर पूछे जाने वाले सवाल<\/h2>/);
  assert.match(hi.content, /<h2>स्रोत<\/h2><ol><li><a href="https:\/\/src\.example\/a">Phone survey 2026<\/a><\/li><\/ol>/, 'the source list is kept as it is');
  assert.match(hi.content, /42 शब्द[^<]*<sup><a href="https:\/\/src\.example\/a"/);
  assert.equal(hi.seo.faq.length, 1, 'the Hindi FAQ is still found');

  // Public: lists stay in one language; the post links to its other version.
  const list = await request(app).get('/api/public/articles').expect(200);
  assert.ok(!list.body.items.some((x) => x.language === 'hi'));
  const search = await request(app).get('/api/public/articles?q=phones').expect(200);
  assert.ok(search.body.items.some((x) => x.slug === src.slug), 'search still works');
  const hiList = await request(app).get('/api/public/articles?lang=hi').expect(200);
  assert.deepEqual(hiList.body.items.map((x) => x.slug), [hi.slug]);
  const pub = await request(app).get(`/api/public/articles/${src.slug}`).expect(200);
  assert.deepEqual(pub.body.translations.map((x) => [x.language, x.slug]), [['hi', hi.slug]]);
  assert.ok((await request(app).get('/api/public/settings').expect(200)).body.settings.languages.includes('hi'));
  const head = headToHtml(await renderHead(`/blog/${hi.slug}`, SITE), 'Site');
  assert.match(head, new RegExp(`<link rel="alternate" hreflang="en" href="${SITE}/blog/${src.slug}" />`));
  assert.match(head, new RegExp(`<link rel="alternate" hreflang="hi" href="${SITE}/blog/${hi.slug}" />`));
  assert.match(head, /hreflang="x-default"/);
  assert.equal((await renderHead(`/blog/${hi.slug}`, SITE)).lang, 'hi');
  const sitemap = await buildSitemap(SITE);
  assert.match(sitemap, new RegExp(`<loc>${SITE}/blog/${src.slug}</loc>.*<xhtml:link rel="alternate" hreflang="hi" href="${SITE}/blog/${hi.slug}"/>`));

  // A translation that changes a number is rejected (and tried again, then given up).
  sim.translateMode = 'badNumber';
  const src2 = await publish({ title: 'Second phone list', content: '<p>Prices start at 199 dollars.</p>' });
  assert.equal(await translateNext(), true);
  const t2 = await Translation.findOne({ source: src2._id });
  assert.equal(t2.status, 'failed');
  assert.match(t2.error, /numbers changed/);
  assert.equal(await Article.countDocuments({ translationOf: src2._id }), 0);

  // By hand, for a post that is not published yet: waits for approval.
  sim.translateMode = 'good';
  const draft = await request(app).post('/api/admin/articles').set(as('admin')).send({ title: 'Draft about tablets', content: '<p>Tablets are handy.</p>' }).expect(201);
  await request(app).post(`/api/admin/articles/${draft.body.article._id}/translate`).set(as('author')).send({ lang: 'hi' }).expect(403);
  await request(app).post(`/api/admin/articles/${draft.body.article._id}/translate`).set(as('editor')).send({ lang: 'hi' }).expect(202);
  await request(app).post(`/api/admin/articles/${draft.body.article._id}/translate`).set(as('editor')).send({ lang: 'hi' }).expect(400);
  await translateNext();
  const hiDraft = await Article.findOne({ translationOf: draft.body.article._id });
  assert.equal(hiDraft.status, 'pending_approval');
  const editorView = await request(app).get(`/api/admin/articles/${draft.body.article._id}`).set(as('editor')).expect(200);
  assert.equal(editorView.body.translations[0].language, 'hi');
  assert.equal(editorView.body.translationTask.status, 'completed');
  await Growth.updateOne({ key: 'growth' }, { $set: { 'translation.hindi': false } });
});

test('evergreen mix: two of four daily posts are evergreen guides, taken from your own list first', async () => {
  assert.deepEqual([0, 1, 2, 3].map((i) => slotKind(i, 4, 2)), ['trending', 'evergreen', 'trending', 'evergreen']);
  assert.deepEqual([0, 1, 2, 3].map((i) => slotKind(i, 4, 0)), ['trending', 'trending', 'trending', 'trending']);
  assert.deepEqual([0, 1, 2].map((i) => slotKind(i, 3, 3)), ['evergreen', 'evergreen', 'evergreen']);
  assert.equal(localDayStart(new Date('2026-11-18T20:00:00Z'), 'Asia/Kolkata').toISOString(), '2026-11-18T18:30:00.000Z');

  await SiteSettings.updateOne({ key: 'site' }, { $set: { 'autopilot.evergreenTopics': ['How to back up your phone photos'], 'autopilot.evergreenPerDay': 2, 'autopilot.postsPerDay': 4 } });
  const job = await startAutopilotPost('test', 'evergreen');
  assert.equal(job.autopilot.kind, 'evergreen');
  assert.equal(job.input.topic, 'How to back up your phone photos');
  assert.match(job.input.instructions, /evergreen guide/);
  assert.deepEqual((await SiteSettings.getSingleton()).autopilot.evergreenTopics, [], 'used topics leave the list');

  const job2 = await startAutopilotPost('test', 'evergreen');
  assert.equal(job2.input.topic, 'How to choose a laptop for coding');
  assert.equal(job2.input.primaryKeyword, 'laptop for coding');
  assert.equal(job2.autopilot.trend, '');
  assert.ok(sim.calls.includes('tavily'), 'real article titles were used as hints');
  // Two Autopilot posts exist today, so the next is the third of the day: trending.
  assert.equal(await nextKind((await SiteSettings.getSingleton()).autopilot), 'trending');

  const view = await request(app).get('/api/admin/autopilot').set(as('admin')).expect(200);
  assert.deepEqual(view.body.slotKinds, ['trending', 'evergreen', 'trending', 'evergreen']);
  await ResearchJob.deleteMany({});
});

test('post refresh: falling posts are found, re-researched and the update waits for approval at the same address', async () => {
  const old = await Article.create({ title: 'Old laptop guide', slug: 'old-laptop-guide', content: '<h2>Specs</h2><p>Old text.</p>', status: 'published', publishedAt: new Date(Date.now() - 200 * 86400000), author: users.admin._id, seo: { focusKeyword: 'laptop guide' } });
  const steady = await Article.create({ title: 'Steady post', slug: 'steady-post', content: '<p>x</p>', status: 'published', publishedAt: new Date(Date.now() - 120 * 86400000), author: users.admin._id });
  await Article.create({ title: 'Too new', slug: 'too-new', content: '<p>x</p>', status: 'published', publishedAt: new Date(Date.now() - 10 * 86400000), author: users.admin._id });
  const day = (d) => dayKey(new Date(Date.now() - d * 86400000));
  await ArticleStat.create([
    { day: day(40), article: old._id, views: 50 },
    { day: day(3), article: old._id, views: 10 },
    { day: day(40), article: steady._id, views: 5 },
    { day: day(3), article: steady._id, views: 6 },
  ]);
  const list = await refresh.refreshCandidates();
  assert.deepEqual(list.map((c) => c.slug).slice(0, 2), ['old-laptop-guide', 'steady-post']);
  assert.ok(!list.some((c) => c.slug === 'too-new'));
  assert.match(list[0].reasons[0], /visits down 80% \(last 4 weeks: 10, the 4 weeks before: 50\)/);

  await request(app).post(`/api/admin/articles/${old._id}/refresh`).set(as('author')).expect(403);
  const started = await request(app).post(`/api/admin/articles/${old._id}/refresh`).set(as('editor')).expect(201);
  const job = await ResearchJob.findById(started.body.job._id);
  assert.equal(String(job.input.refreshOf), String(old._id));
  assert.match(job.input.instructions, /update of an existing published post titled "Old laptop guide"[\s\S]*Specs/);
  await request(app).post(`/api/admin/articles/${old._id}/refresh`).set(as('editor')).expect(400, /already running/);
  const overview = await request(app).get('/api/admin/refresh').set(as('editor')).expect(200);
  assert.ok(!overview.body.candidates.some((c) => c.slug === 'old-laptop-guide'), 'a post being refreshed is not offered again');

  // The pipeline leaves the update on the post (simulated here; the AI test runs it for real).
  await ResearchJob.updateOne({ _id: job._id }, { $set: { status: 'completed' } });
  await Article.updateOne({ _id: old._id }, { $set: { refresh: { job: job._id, title: 'Laptop guide (updated)', content: '<h2>Specs</h2><p>New text for 2026.</p>', seo: { title: 'Laptop guide', description: 'Updated.' }, sources: [], featuredImage: { url: '' }, words: 5, createdAt: new Date() } } });
  await TelegramBot.updateOne({ key: 'telegram' }, { $set: { enabled: true, chats: [{ chatId: '500', fromId: '500', title: 'Me', user: users.admin._id }] } }, { upsert: true });
  await request(app).put('/api/admin/telegram').set(as('admin')).send({ token: TG_TOKEN }).expect(200);
  sim.telegram = [];
  await bot.notifyRefreshReady(await Article.findById(old._id));
  const msg = sim.telegram.find((m) => m.method === 'sendMessage');
  assert.match(msg.text, /Updated version ready/);
  assert.deepEqual(msg.reply_markup.inline_keyboard[0].map((b) => b.callback_data), [`u:${old._id}`, `d:${old._id}`]);
  await bot.handleUpdate({ update_id: 10, callback_query: { id: 'cb1', from: { id: 500 }, data: `u:${old._id}`, message: { message_id: 1, chat: { id: 500 }, text: msg.text } } });
  const applied = await Article.findById(old._id);
  assert.equal(applied.slug, 'old-laptop-guide', 'same address');
  assert.equal(applied.title, 'Laptop guide (updated)');
  assert.match(applied.content, /New text for 2026/);
  assert.equal(applied.seo.focusKeyword, 'laptop guide');
  assert.ok(applied.refreshedAt);
  assert.equal(applied.refresh, undefined);
  await request(app).post(`/api/admin/articles/${old._id}/refresh/apply`).set(as('editor')).expect(400);

  // Discarding keeps the post as it is.
  await Article.updateOne({ _id: steady._id }, { $set: { refresh: { title: 'x', content: '<p>y</p>', createdAt: new Date() } } });
  await request(app).delete(`/api/admin/articles/${steady._id}/refresh`).set(as('editor')).expect(204);
  assert.equal((await Article.findById(steady._id)).content, '<p>x</p>');

  // Weekly automatic refresh: one per week when a candidate is falling.
  await Growth.updateOne({ key: 'growth' }, { $set: { 'refresh.perWeek': 1 }, $unset: { 'refresh.lastStartedAt': 1 } });
  await ResearchJob.deleteMany({});
  const weekly = await refresh.refreshTick();
  assert.ok(weekly, 'a refresh was started');
  assert.equal(await refresh.refreshTick(), null, 'not twice in the same week');
  await ResearchJob.deleteMany({});
  await TelegramBot.deleteMany({});
});

test('faster photos: WebP copies in three sizes, srcset in posts; Unsplash photos use its resizer', async () => {
  const real = optimize._deps.loadSharp;
  const fake = () => {
    const o = { w: 0 };
    o.metadata = async () => ({ width: 2000, height: 1000 });
    o.rotate = () => o;
    o.resize = ({ width }) => {
      o.w = width;
      return o;
    };
    o.webp = () => o;
    o.toBuffer = async () => Buffer.from(`webp-${o.w}`);
    return o;
  };
  optimize._deps.loadSharp = async () => fake;
  const name = `opt-test-${Date.now()}`;
  fs.mkdirSync(env.uploadDir, { recursive: true });
  fs.writeFileSync(path.join(env.uploadDir, `${name}.jpg`), Buffer.from([0xff, 0xd8, 0xff, 0x00]));
  try {
    await Media.create({ filename: `${name}.jpg`, url: `/uploads/${name}.jpg`, mimeType: 'image/jpeg', size: 4 });
    const a = await Article.create({ title: 'Photo post', slug: `photo-post-${Date.now()}`, content: `<p>x</p><figure><img src="/uploads/${name}.jpg" alt="x" loading="lazy" /></figure>`, featuredImage: { url: `/uploads/${name}.jpg`, alt: 'x' }, author: users.admin._id });
    const res = await request(app).post('/api/admin/media/optimize').set(as('admin')).expect(200);
    assert.equal(res.body.result.optimised, 1);
    assert.ok(fs.existsSync(path.join(env.uploadDir, `${name}-480w.webp`)));
    const m = await Media.findOne({ filename: `${name}.jpg` });
    assert.deepEqual(m.variants.map((v) => v.width), [480, 960, 1600]);
    assert.equal(m.width, 2000);
    const post = await Article.findById(a._id);
    assert.deepEqual(post.featuredImage.variants.map((v) => v.width), [480, 960, 1600]);
    assert.match(post.content, new RegExp(`<img srcset="/uploads/${name}-480w.webp 480w, /uploads/${name}-960w.webp 960w, /uploads/${name}-1600w.webp 1600w" sizes="[^"]+" src="/uploads/${name}.jpg"`));
    // Saving the post through the editor keeps srcset (the sanitizer allows it).
    await request(app).put(`/api/admin/articles/${a._id}`).set(as('admin')).send({ title: post.title, content: post.content, featuredImage: { url: post.featuredImage.url, alt: 'x' } }).expect(200);
    assert.match((await Article.findById(a._id)).content, /srcset=/);
  } finally {
    optimize._deps.loadSharp = real;
    for (const f of fs.readdirSync(env.uploadDir).filter((x) => x.startsWith(name))) fs.rmSync(path.join(env.uploadDir, f), { force: true });
  }
  const remote = optimize.remoteVariants('https://images.unsplash.com/photo-1?ixid=abc&w=1600', 1600);
  assert.deepEqual(remote.map((v) => v.width), [480, 960, 1600]);
  assert.match(remote[0].url, /w=480&fm=webp&q=75&fit=max/);
  assert.equal(optimize.remoteVariants('https://example.com/a.jpg'), undefined);
  optimize._deps.loadSharp = async () => null;
  await request(app).post('/api/admin/media/optimize').set(as('admin')).expect(400, /not installed/);
  optimize._deps.loadSharp = real;
});
