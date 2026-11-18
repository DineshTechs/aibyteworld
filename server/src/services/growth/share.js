import crypto from 'node:crypto';
import { logger } from '../../config/logger.js';
import { tg, tgEscape } from '../../integrations/telegram.js';
import { Article, Growth, TelegramBot } from '../../models/index.js';
import { apiFetch } from '../../utils/apiFetch.js';
import { decryptSecret } from '../../utils/crypto.js';
import { NOT_PUBLIC, absolute, articleUrl, growthWithSecrets, hasSecret, secretOf, siteContext } from './common.js';

// Shares each newly published post once per channel: a public Telegram
// channel, X (Twitter), LinkedIn and a Facebook Page. Messages are built from
// the post's own title, summary and tags; nothing is invented.

export const CHANNELS = ['telegram', 'x', 'linkedin', 'facebook'];
export const CHANNEL_NAMES = { telegram: 'Telegram channel', x: 'X (Twitter)', linkedin: 'LinkedIn', facebook: 'Facebook Page' };

// ---------- Message text ----------
export function hashtags(article, n) {
  const out = [];
  for (const t of article.tags || []) {
    const name = typeof t === 'string' ? t : t?.name;
    const tag = String(name || '')
      .split(/[^\p{L}\p{M}\p{N}]+/u)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join('');
    if (tag.length >= 2 && tag.length <= 30 && !out.includes(tag)) out.push(tag);
    if (out.length >= n) break;
  }
  return out;
}

const cut = (s, max) => (s.length <= max ? s : `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…`);

// X counts every link as 23 characters.
export function xText(article, url, tags) {
  const tagText = tags.map((t) => `#${t}`).join(' ');
  const room = 280 - 23 - 4 - (tagText ? tagText.length + 2 : 0);
  return `${cut(article.title, Math.max(40, room))}\n\n${url}${tagText ? `\n\n${tagText}` : ''}`;
}

// LinkedIn "little text" format: reserved characters need a backslash.
const liEscape = (s) => String(s).replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);
export function linkedinText(article, tags) {
  const parts = [liEscape(article.title), article.excerpt ? liEscape(cut(article.excerpt, 600)) : '', tags.map((t) => `{hashtag|\\#|${t}}`).join(' ')];
  return parts.filter(Boolean).join('\n\n');
}

export function telegramPost(article, url, tags, image) {
  const lines = [`<b>${tgEscape(article.title)}</b>`];
  if (article.excerpt) lines.push(tgEscape(cut(article.excerpt, 600)));
  lines.push(`<a href="${tgEscape(url)}">Read the full post →</a>`);
  if (tags.length) lines.push(tags.map((t) => `#${t}`).join(' '));
  return { text: lines.join('\n\n'), image };
}

// ---------- OAuth 1.0a for X ----------
const enc = (s) => encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
export function oauth1Header({ method, url, consumerKey, consumerSecret, token, tokenSecret, params = {}, nonce, timestamp }) {
  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce || crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(timestamp || Math.floor(Date.now() / 1000)),
    oauth_token: token,
    oauth_version: '1.0',
  };
  const u = new URL(url);
  const all = [...u.searchParams.entries(), ...Object.entries(params), ...Object.entries(oauth)].map(([k, v]) => [enc(k), enc(v)]);
  all.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  const baseString = [method.toUpperCase(), enc(`${u.protocol}//${u.host}${u.pathname}`), enc(all.map(([k, v]) => `${k}=${v}`).join('&'))].join('&');
  const signature = crypto.createHmac('sha1', `${enc(consumerSecret)}&${enc(tokenSecret)}`).update(baseString).digest('base64');
  return `OAuth ${Object.entries({ ...oauth, oauth_signature: signature }).sort().map(([k, v]) => `${enc(k)}="${enc(v)}"`).join(', ')}`;
}

// LinkedIn API version: two months back is always a supported version.
export function linkedinVersion(configured, now = new Date()) {
  if (/^\d{6}$/.test(configured || '')) return configured;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ---------- Senders ----------
async function telegramToken() {
  const doc = await TelegramBot.findOne({ key: 'telegram' }).select('+token.iv +token.tag +token.data');
  return doc?.token?.data ? decryptSecret(doc.token) : '';
}

const xCreds = (g) => ({
  consumerKey: secretOf(g, 'share.x.apiKey'),
  consumerSecret: secretOf(g, 'share.x.apiSecret'),
  token: secretOf(g, 'share.x.accessToken'),
  tokenSecret: secretOf(g, 'share.x.accessSecret'),
});

const SENDERS = {
  async telegram(g, post) {
    const token = await telegramToken();
    if (!token) throw new Error('Set up the Telegram bot first (admin → Telegram).');
    const chat = g.share.telegram.channel;
    const tp = telegramPost(post.article, post.url, post.tags, post.image);
    const msg = tp.image && tp.text.length <= 1024
      ? await tg(token, 'sendPhoto', { chat_id: chat, photo: tp.image, caption: tp.text, parse_mode: 'HTML' })
      : await tg(token, 'sendMessage', { chat_id: chat, text: tp.text, parse_mode: 'HTML', link_preview_options: { url: post.url, prefer_large_media: true } });
    return String(msg?.message_id || '');
  },
  async x(g, post) {
    const url = 'https://api.x.com/2/tweets';
    const { data } = await apiFetch('X', url, { method: 'POST', headers: { Authorization: oauth1Header({ method: 'POST', url, ...xCreds(g) }) }, body: { text: xText(post.article, post.url, post.tags) } });
    return String(data?.data?.id || '');
  },
  async linkedin(g, post) {
    const li = g.share.linkedin;
    if (!li.author) throw new Error('Enter the LinkedIn author (urn:li:person:… or urn:li:organization:…) or press Check to find it.');
    const res = await apiFetch('LinkedIn', 'https://api.linkedin.com/rest/posts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secretOf(g, 'share.linkedin.token')}`, 'LinkedIn-Version': linkedinVersion(li.version), 'X-Restli-Protocol-Version': '2.0.0' },
      body: {
        author: li.author,
        commentary: linkedinText(post.article, post.tags),
        visibility: 'PUBLIC',
        distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        content: { article: { source: post.url, title: cut(post.article.title, 200), description: cut(post.article.excerpt || '', 250) } },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      },
    });
    return String(res.headers.get('x-restli-id') || '');
  },
  async facebook(g, post) {
    const fb = g.share.facebook;
    const message = [post.article.excerpt ? cut(post.article.excerpt, 600) : post.article.title, post.tags.map((t) => `#${t}`).join(' ')].filter(Boolean).join('\n\n');
    const { data } = await apiFetch('Facebook', `https://graph.facebook.com/${encodeURIComponent(fb.pageId)}/feed`, { method: 'POST', form: { message, link: post.url, access_token: secretOf(g, 'share.facebook.token') } });
    return String(data?.id || '');
  },
};

// Whether a channel has everything it needs (and is switched on).
export function channelReady(g, ch, { tgToken = true } = {}) {
  const s = g.share[ch];
  if (!s?.enabled) return false;
  if (ch === 'telegram') return Boolean(s.channel) && tgToken;
  if (ch === 'x') return ['apiKey', 'apiSecret', 'accessToken', 'accessSecret'].every((k) => hasSecret(g, `share.x.${k}`));
  if (ch === 'linkedin') return hasSecret(g, 'share.linkedin.token');
  if (ch === 'facebook') return Boolean(s.pageId) && hasSecret(g, 'share.facebook.token');
  return false;
}

/**
 * Shares a published post to every ready channel it has not been shared to.
 * `retry` also re-sends channels whose earlier attempt failed. Never throws.
 */
export async function shareArticle(articleId, { retry = false, only } = {}) {
  try {
    const article = await Article.findById(articleId).populate('tags', 'name').lean();
    if (!article || article.status !== 'published' || article.publishedAt > new Date()) return { skipped: 'the post is not published' };
    const g = await growthWithSecrets();
    if (article.translationOf && !g.share.includeTranslations) return { skipped: 'translations are not shared' };
    const channels = CHANNELS.filter((ch) => (!only || only.includes(ch)) && channelReady(g, ch));
    if (!channels.length) return { skipped: 'no sharing channel is set up' };
    const { base } = await siteContext();
    if (!base) {
      await Growth.updateOne({ key: 'growth' }, { $set: { 'share.lastSkipped': `"${article.title}" was not shared: ${NOT_PUBLIC}.`.slice(0, 300) } });
      return { skipped: NOT_PUBLIC };
    }
    const image = absolute(base, article.featuredImage?.url);
    const post = { article, url: articleUrl(base, article), tags: hashtags(article, g.share.hashtags), image: /^https:\/\//.test(image) ? image : '' };
    const results = {};
    for (const ch of channels) {
      if (retry) await Article.updateOne({ _id: article._id }, { $pull: { shares: { channel: ch, ok: false } } });
      // Claim the channel first, so two publish events can never share twice.
      // eslint-disable-next-line no-await-in-loop
      const claim = await Article.updateOne({ _id: article._id, 'shares.channel': { $ne: ch } }, { $push: { shares: { channel: ch, at: new Date(), ok: false, error: 'sending' } } });
      if (claim.modifiedCount !== 1) {
        results[ch] = { skipped: 'already shared' };
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        const ref = await SENDERS[ch](g, post);
        // eslint-disable-next-line no-await-in-loop
        await Article.updateOne({ _id: article._id, 'shares.channel': ch }, { $set: { 'shares.$.ok': true, 'shares.$.ref': ref, 'shares.$.error': '', 'shares.$.at': new Date() } });
        // eslint-disable-next-line no-await-in-loop
        await Growth.updateOne({ key: 'growth' }, { $set: { [`share.${ch}.lastOkAt`]: new Date(), [`share.${ch}.lastError`]: '' } });
        results[ch] = { ok: true, ref };
      } catch (err) {
        const msg = String(err.message || err).slice(0, 300);
        logger.warn({ channel: ch, err: msg }, 'Sharing failed');
        // eslint-disable-next-line no-await-in-loop
        await Article.updateOne({ _id: article._id, 'shares.channel': ch }, { $set: { 'shares.$.error': msg, 'shares.$.at': new Date() } });
        // eslint-disable-next-line no-await-in-loop
        await Growth.updateOne({ key: 'growth' }, { $set: { [`share.${ch}.lastError`]: msg } });
        results[ch] = { ok: false, error: msg };
      }
    }
    await Growth.updateOne({ key: 'growth' }, { $set: { 'share.lastSkipped': '' } });
    return { results };
  } catch (err) {
    logger.warn({ err: err.message }, 'Sharing failed');
    return { error: err.message };
  }
}

// ---------- Connection checks (nothing is posted) ----------
export async function checkChannel(ch) {
  const g = await growthWithSecrets();
  if (ch === 'telegram') {
    const token = await telegramToken();
    if (!token) throw new Error('Set up the Telegram bot first (admin → Telegram).');
    if (!g.share.telegram.channel) throw new Error('Enter the channel, for example @mychannel.');
    const [chat, me] = await Promise.all([tg(token, 'getChat', { chat_id: g.share.telegram.channel }), tg(token, 'getMe')]);
    const member = await tg(token, 'getChatMember', { chat_id: g.share.telegram.channel, user_id: me.id });
    if (member.status !== 'administrator' || member.can_post_messages === false) throw new Error(`The bot is in "${chat.title}" but is not an admin allowed to post. Add @${me.username} as a channel admin with "Post messages".`);
    return `The bot can post to "${chat.title}".`;
  }
  if (ch === 'x') {
    const url = 'https://api.x.com/2/users/me';
    const { data } = await apiFetch('X', url, { headers: { Authorization: oauth1Header({ method: 'GET', url, ...xCreds(g) }) } });
    return `Connected as @${data?.data?.username || '?'}.`;
  }
  if (ch === 'linkedin') {
    const token = secretOf(g, 'share.linkedin.token');
    if (!token) throw new Error('Enter an access token.');
    if (!g.share.linkedin.author) {
      const { data } = await apiFetch('LinkedIn', 'https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${token}` } });
      if (!data?.sub) throw new Error('The token works but LinkedIn did not say who it belongs to. Enter the author URN yourself.');
      await Growth.updateOne({ key: 'growth' }, { $set: { 'share.linkedin.author': `urn:li:person:${data.sub}` } });
      return `Connected as ${data.name || 'your profile'}; posts will go to your profile.`;
    }
    await apiFetch('LinkedIn', 'https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${token}` } }).catch((err) => {
      if (err.status === 401) throw err;
    });
    return `Token accepted; posts go to ${g.share.linkedin.author}.`;
  }
  if (ch === 'facebook') {
    const fb = g.share.facebook;
    if (!fb.pageId) throw new Error('Enter the Page ID.');
    const { data } = await apiFetch('Facebook', `https://graph.facebook.com/${encodeURIComponent(fb.pageId)}?fields=name`, { headers: { Authorization: `Bearer ${secretOf(g, 'share.facebook.token')}` } });
    return `The token can reach the Page "${data?.name || fb.pageId}".`;
  }
  throw new Error('Unknown channel');
}
