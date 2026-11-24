import crypto from 'node:crypto';
import { logger } from '../../config/logger.js';
import { TelegramError, tg, tgEscape as esc } from '../../integrations/telegram.js';
import { Article, ResearchJob, SiteSettings, TelegramBot, User } from '../../models/index.js';
import { htmlToText } from '../../utils/content.js';
import { decryptSecret } from '../../utils/crypto.js';
import { logActivity } from '../activityService.js';
import { providerChain } from '../ai/providerService.js';
import { analyticsOverview } from '../analyticsService.js';
import { startAutopilotPost } from '../autopilot/runner.js';
import { nextRunTime } from '../autopilot/schedule.js';
import { afterPublish } from '../publishHooks.js';
import { applyRefresh, discardRefresh } from '../refresh/refreshService.js';
import { SpinError, replaceArticleCover } from '../images/coverSpin.js';
import { rotationOrder } from '../categories.js';
import { JobStartError, startAiJob } from '../ai/jobService.js';

// Telegram bot: sends notifications, lets linked admins approve or reject
// posts with buttons, and answers a few commands. It polls Telegram for
// updates (getUpdates), so it works without a public web address.

const WITH_TOKEN = '+token.iv +token.tag +token.data';
const STATUS_WORDS = { draft: 'a draft', pending_approval: 'waiting for approval', published: 'published', scheduled: 'scheduled', archived: 'archived' };

async function load() {
  const doc = (await TelegramBot.findOne({ key: 'telegram' }).select(WITH_TOKEN)) || (await TelegramBot.getSingleton());
  let token = '';
  try {
    token = doc.token?.data ? decryptSecret(doc.token) : '';
  } catch (err) {
    logger.warn({ err: err.message }, 'Telegram token could not be decrypted');
  }
  return { doc, token };
}

async function recordError(err) {
  await TelegramBot.updateOne({ key: 'telegram' }, { $set: { lastError: String(err.message || err).slice(0, 300) } }).catch(() => {});
}

const timeIn = (date, tz) => (date ? new Date(date).toLocaleString('en-GB', { timeZone: tz || 'UTC', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–');

// The site's public address, if it has one (Telegram cannot open localhost links).
async function publicBase() {
  const url = ((await SiteSettings.getSingleton()).siteUrl || '').replace(/\/+$/, '');
  return url && !/\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(url) ? url : '';
}

async function articleButtons(article) {
  const rows = [
    [
      { text: '✅ Publish', callback_data: `a:${article._id}` },
      { text: '↩️ Reject (back to draft)', callback_data: `r:${article._id}` },
    ],
  ];
  rows.push([{ text: article.featuredImage?.url ? '🔄 New photo' : '🖼 Find a photo', callback_data: `p:${article._id}` }]);
  const base = await publicBase();
  if (base) rows.push([{ text: 'Open in admin', url: `${base}/admin/articles/${article._id}/edit` }]);
  return rows;
}

// Buttons for a post that is not waiting for approval (for example one
// Autopilot published): read it, change its photo, open it in the admin.
async function liveButtons(article) {
  const base = await publicBase();
  const rows = [];
  if (base && article.status === 'published') rows.push([{ text: 'Read it', url: `${base}/blog/${article.slug}` }]);
  rows.push([{ text: article.featuredImage?.url ? '🔄 New photo' : '🖼 Find a photo', callback_data: `p:${article._id}` }]);
  if (base) rows.push([{ text: 'Open in admin', url: `${base}/admin/articles/${article._id}/edit` }]);
  return rows;
}

// The right buttons for a post's current state.
const postButtons = (article) => (article.status === 'pending_approval' ? articleButtons(article) : liveButtons(article));

// The cover photo's public address, which Telegram fetches itself. Needs the
// site's public address; on a local test setup no photo is sent.
async function coverUrl(article) {
  const url = article?.featuredImage?.url || '';
  if (/^https:\/\//i.test(url)) return url;
  const base = await publicBase();
  return url.startsWith('/') && base ? `${base}${url}` : '';
}

function articleSummary(article) {
  const words = htmlToText(article.content || '').split(/\s+/).filter(Boolean).length;
  const photos = (String(article.content || '').match(/<figure>/g) || []).length + (article.featuredImage?.url ? 1 : 0);
  const lines = [`<b>${esc(article.title)}</b>`];
  if (article.excerpt) lines.push(esc(article.excerpt.slice(0, 220)));
  lines.push(`${words} words · ${article.sources?.length || 0} sources · ${photos} photo${photos === 1 ? '' : 's'}`);
  return lines.join('\n');
}

/** Sends a message to every linked chat. Never throws; returns how many were sent. */
export async function sendToChats(text, { buttons, only, photo } = {}) {
  try {
    const { doc, token } = await load();
    if (!doc.enabled || !token) return 0;
    let sent = 0;
    const markup = buttons ? { reply_markup: { inline_keyboard: buttons } } : {};
    for (const chat of doc.chats.filter((c) => !only || c.chatId === only)) {
      try {
        // With a cover photo: the photo with the text as its caption (Telegram
        // allows 1024 characters there). If the photo cannot be sent, plain text.
        let done = false;
        if (photo && text.length <= 1024) {
          // eslint-disable-next-line no-await-in-loop
          done = await tg(token, 'sendPhoto', { chat_id: chat.chatId, photo, caption: text, parse_mode: 'HTML', ...markup }).then(
            () => true,
            (err) => {
              logger.warn({ chat: chat.chatId, err: err.message }, 'Telegram photo failed; sending text');
              return false;
            },
          );
        }
        // eslint-disable-next-line no-await-in-loop
        if (!done) await tg(token, 'sendMessage', { chat_id: chat.chatId, text: text.slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true, ...markup });
        sent += 1;
      } catch (err) {
        logger.warn({ chat: chat.chatId, err: err.message }, 'Telegram message failed');
        // eslint-disable-next-line no-await-in-loop
        await recordError(err);
      }
    }
    return sent;
  } catch (err) {
    logger.warn({ err: err.message }, 'Telegram notification failed');
    return 0;
  }
}

async function notify(kind, build) {
  try {
    const doc = await TelegramBot.findOne({ key: 'telegram' }).lean();
    if (!doc?.enabled || !doc.chats?.length || doc.notify?.[kind] === false) return 0;
    const { text, buttons, photo } = await build();
    return await sendToChats(text, { buttons, photo });
  } catch (err) {
    logger.warn({ kind, err: err.message }, 'Telegram notification failed');
    return 0;
  }
}

// ---------- Notifications ----------
export const notifyHeld = (article, reasons) =>
  notify('held', async () => ({
    text: `⏸ <b>Autopilot post waiting for your approval</b>\n\n${articleSummary(article)}\n\nWhy it was held:\n${reasons.map((r) => `• ${esc(r)}`).join('\n')}`,
    buttons: await articleButtons(article),
    photo: await coverUrl(article),
  }));

export const notifyReview = (article) =>
  notify('review', async () => ({ text: `📝 <b>New AI article ready for review</b>\n\n${articleSummary(article)}`, buttons: await articleButtons(article), photo: await coverUrl(article) }));

export const notifySubmitted = (article, byName) =>
  notify('submitted', async () => ({ text: `📨 <b>${esc(byName)} submitted a post for approval</b>\n\n${articleSummary(article)}`, buttons: await articleButtons(article), photo: await coverUrl(article) }));

export const notifyAutopilotPublished = (article) =>
  notify('published', async () => ({
    text: `🚀 <b>Autopilot published a post</b> (all checks passed)\n\n${articleSummary(article)}`,
    buttons: await liveButtons(article),
    photo: await coverUrl(article),
  }));

// A refreshed version of an older post is ready: apply it or keep the current one.
export const notifyRefreshReady = (article) =>
  notify('review', async () => {
    const r = article.refresh || {};
    const base = await publicBase();
    const rows = [[{ text: '✅ Apply update', callback_data: `u:${article._id}` }, { text: '🗑 Discard', callback_data: `d:${article._id}` }]];
    if (base) rows.push([{ text: 'Compare in admin', url: `${base}/admin/articles/${article._id}/edit` }]);
    return {
      text: `🔄 <b>Updated version ready</b>

<b>${esc(article.title)}</b>${r.title && r.title !== article.title ? `
New title: ${esc(r.title)}` : ''}
${r.words || 0} words · ${r.sources?.length || 0} sources

Applying it keeps the same address, so rankings and links are kept.`,
      buttons: rows,
    };
  });

export const notifyFailed = (message) => notify('failed', async () => ({ text: `⚠️ ${esc(message).slice(0, 1500)}` }));

// An AI article started (or resumed after a restart).
export const notifyStarted = (job, { resumed = false, categoryName = '', byName = '' } = {}) =>
  notify('started', async () => {
    const i = job.input || {};
    let what;
    if (i.refreshOf) what = 'Updating an older post';
    else if (job.autopilot?.enabled) what = `Autopilot · ${job.autopilot.kind === 'evergreen' ? 'evergreen guide' : 'trending story'}${categoryName ? ` · ${esc(categoryName)}` : ''}`;
    else if (i.siteUrl) what = `About the website ${esc(i.siteUrl)}${i.sponsored ? ' (sponsored)' : ''}${byName ? ` · started by ${esc(byName)}` : ''}`;
    else what = `AI Content Studio${byName ? ` · started by ${esc(byName)}` : ''}`;
    const topic = i.topicAuto && !job.website ? '' : `\n<b>${esc(i.topic || '')}</b>`;
    return { text: `✍️ <b>${resumed ? 'Writing resumed' : 'Writing started'}</b>${resumed ? ' (after a restart)' : ''}${topic}\n${what}\nUsually 5–10 minutes. You will get the result here.` };
  });

// Things that went wrong while writing an article that still finished:
// provider switches, photos or website pages that could not be fetched, fallbacks.
const PROBLEM = /^(?:No cover photo|No photo for|No images were added|Photo searches were made|The cover photo was found|The first in-article photo|Reading |No screenshot|No site image|SEO metadata was generated|The humanise pass was not used|The writing model reached|Skipped)/;
export function problemsOf(job) {
  const out = (job.switches || []).slice(0, 6).map((x) => `${x.step}: switched from ${x.from} to ${x.to}${x.reason ? ` (${x.reason})` : ''}`);
  for (const w of job.warnings || []) if (PROBLEM.test(w)) out.push(w);
  return out.slice(0, 10);
}
export const notifyProblems = (job, title) => {
  const list = problemsOf(job);
  if (!list.length) return Promise.resolve(0);
  return notify('problems', async () => ({ text: `🟡 <b>Problems while writing</b> "${esc(title || job.input?.topic || '')}" (the article was still finished)\n\n${list.map((x) => `• ${esc(x).slice(0, 300)}`).join('\n')}` }));
};

// A post scheduled in the admin went live.
export const notifyScheduledPublished = (article) =>
  notify('published', async () => ({ text: `📅 <b>Scheduled post published</b>\n\n${articleSummary(article)}`, buttons: await liveButtons(article), photo: await coverUrl(article) }));

// Site and background problems: restarts, scheduler, translation, newsletter
// or sharing errors. The same kind of problem is sent at most once an hour,
// so a fault that repeats every few seconds cannot flood the chat.
const lastSystem = new Map();
export function notifySystem(key, message, { everyMs = 3600000, icon = '🛠' } = {}) {
  const now = Date.now();
  if (now - (lastSystem.get(key) || 0) < everyMs) return Promise.resolve(0);
  lastSystem.set(key, now);
  return notify('system', async () => ({ text: `${icon} ${esc(message).slice(0, 1500)}` }));
}
export const _resetSystemThrottle = () => lastSystem.clear();

// ---------- Approve / reject ----------
async function decide(articleId, action, chat) {
  const user = await User.findOne({ _id: chat.user, active: true });
  if (!user || !['admin', 'editor'].includes(user.role)) return { ok: false, text: 'The blog account linked to this chat can no longer approve posts.' };
  if (action === 'u' || action === 'd') {
    try {
      const a = action === 'u' ? await applyRefresh(articleId, user) : await discardRefresh(articleId, user);
      const when = timeIn(new Date(), (await SiteSettings.getSingleton()).autopilot?.timezone);
      return { ok: true, text: action === 'u' ? `✅ Update applied to "${a.title}" by ${user.name} (${when})` : `🗑 Update discarded by ${user.name} (${when})` };
    } catch (err) {
      return { ok: false, text: `Nothing changed: ${err.message}` };
    }
  }
  const article = await Article.findById(articleId);
  if (!article) return { ok: false, text: 'That post no longer exists.' };
  if (article.status !== 'pending_approval') return { ok: false, text: `Nothing changed: the post is already ${STATUS_WORDS[article.status] || article.status}.` };
  const publish = action === 'a';
  if (publish && !htmlToText(article.content)) return { ok: false, text: 'The post has no content, so it cannot be published.' };
  const now = new Date();
  const next = publish ? 'published' : 'draft';
  const res = await Article.updateOne(
    { _id: article._id, status: 'pending_approval' },
    {
      $set: { status: next, ...(publish && !article.publishedAt ? { publishedAt: now } : {}) },
      $push: { history: { action: `status:pending_approval->${next}`, by: user._id, at: now, note: publish ? 'Approved from Telegram' : 'Rejected from Telegram' } },
    },
  );
  if (res.modifiedCount !== 1) return { ok: false, text: 'Nothing changed: someone else updated the post first.' };
  if (publish) await afterPublish(article._id);
  await logActivity({ user }, `article.${next}`, { entityType: 'Article', entityId: article._id, summary: `"${article.title}": pending_approval -> ${next} (from Telegram)` });
  const when = timeIn(now, (await SiteSettings.getSingleton()).autopilot?.timezone);
  return { ok: true, text: publish ? `✅ Published by ${user.name} (${when})` : `↩️ Rejected by ${user.name} and moved back to drafts (${when})` };
}

// ---------- New cover photo ----------
// Finds a new photo, replaces the post's cover and saves the post. Each press
// asks a different photo library first, and a photo is never used twice.
async function newCover(articleId, chat) {
  const user = await User.findOne({ _id: chat.user, active: true });
  if (!user || !['admin', 'editor'].includes(user.role)) return { ok: false, text: 'The blog account linked to this chat can no longer change posts.' };
  const spins = await Article.findById(articleId, 'history').lean();
  if (!spins) return { ok: false, text: 'That post no longer exists.' };
  const turn = (spins.history || []).filter((h) => h.action === 'cover:spin').length;
  try {
    const { article, photo } = await replaceArticleCover(articleId, user, { turn, via: 'Telegram' });
    return { ok: true, article, text: `🖼 New photo saved (${photo.provider.replace(/ \(.*\)$/, '')}, search: "${photo.query}")` };
  } catch (err) {
    if (err instanceof SpinError) return { ok: false, text: err.message };
    throw err;
  }
}

// ---------- Commands ----------
const HELP = [
  '<b>Commands</b>',
  '/pending – posts waiting for approval',
  '/recent – the latest published posts (change their photo)',
  '/status – Autopilot and AI providers',
  '/stats – visitors today and this week',
  '/run – start an Autopilot post now',
  '/site &lt;address&gt; [notes] – write an article about a website (or just send the address). Add the word sponsored after the address for a sponsored post',
  '/autopilot_on, /autopilot_off – turn Autopilot on or off',
  '/unlink – stop messages to this chat',
].join('\n');

async function cmdPending(chatId) {
  const items = await Article.find({ status: 'pending_approval' }).sort({ updatedAt: -1 }).limit(6);
  const total = await Article.countDocuments({ status: 'pending_approval' });
  if (!items.length) return sendToChats('Nothing is waiting for approval. 🎉', { only: chatId });
  for (const a of items.slice(0, 5)) {
    // eslint-disable-next-line no-await-in-loop
    await sendToChats(articleSummary(a), { only: chatId, buttons: await articleButtons(a), photo: await coverUrl(a) });
  }
  if (total > 5) await sendToChats(`…and ${total - 5} more in the admin under Articles → Pending approval.`, { only: chatId });
  return total;
}

// The latest published posts, each with its photo and a New photo button.
async function cmdRecent(chatId) {
  const items = await Article.find({ status: 'published', translationOf: null }).sort({ publishedAt: -1 }).limit(5);
  if (!items.length) return sendToChats('Nothing has been published yet.', { only: chatId });
  const tz = (await SiteSettings.getSingleton()).autopilot?.timezone;
  for (const a of items) {
    const when = timeIn(a.publishedAt, tz);
    // eslint-disable-next-line no-await-in-loop
    await sendToChats(`${articleSummary(a)}\nPublished ${esc(when)}`, { only: chatId, buttons: await liveButtons(a), photo: await coverUrl(a) });
  }
  return items.length;
}

async function cmdStatus(chatId) {
  const s = await SiteSettings.getSingleton();
  const ap = s.autopilot;
  const [writer, research, images, pending] = await Promise.all([providerChain(s.ai, 'writer'), providerChain(s.ai, 'research'), providerChain(s.ai, 'image'), Article.countDocuments({ status: 'pending_approval' })]);
  const names = (c) => c.chain.map((p) => p.info.name.replace(/ \(.*\)$/, '')).slice(0, 4).join(', ') || 'none ready';
  const next = await rotationOrder(ap);
  const lines = [
    `<b>Autopilot</b>: ${ap.enabled ? `on, ${ap.postsPerDay} posts a day` : 'off'}`,
    ap.enabled ? `Next post: ${timeIn(ap.nextRunAt, ap.timezone)}${next[0] ? ` · ${esc(next[0].name)}` : ''}` : '',
    ap.lastResult ? `Last: ${esc(ap.lastResult.slice(0, 200))}` : '',
    `Waiting for approval: ${pending}`,
    '',
    `<b>Writing</b>: ${esc(names(writer))}`,
    `<b>Research</b>: ${esc(names(research))}`,
    `<b>Photos</b>: ${esc(names(images))}`,
  ];
  return sendToChats(lines.filter((l, i, a) => l || a[i - 1]).join('\n'), { only: chatId });
}

async function cmdStats(chatId) {
  const [day, week] = await Promise.all([analyticsOverview(1), analyticsOverview(7)]);
  const top = week.mostRead[0] || week.mostViewed[0];
  const lines = [
    `<b>Today</b> (UTC): ${day.totals.views} views, ${day.totals.reads} reads`,
    `<b>Last 7 days</b>: ${week.totals.views} views, ${week.totals.reads} reads, read rate ${Math.round(week.totals.readRate * 100)}%`,
    top ? `Top post: ${esc(top.title)} (${top.views} views, ${top.reads} reads)` : 'No visits recorded yet.',
  ];
  return sendToChats(lines.join('\n'), { only: chatId });
}

async function setAutopilot(on, chat) {
  const s = await SiteSettings.getSingleton();
  s.autopilot.enabled = on;
  s.autopilot.nextRunAt = on ? nextRunTime(new Date(), s.autopilot) : null;
  await s.save();
  const user = await User.findById(chat.user);
  await logActivity({ user: user || { _id: chat.user, name: 'Telegram' } }, 'autopilot.update', { summary: `Autopilot turned ${on ? 'on' : 'off'} from Telegram` });
  return sendToChats(on ? `Autopilot is on. Next post: ${timeIn(s.autopilot.nextRunAt, s.autopilot.timezone)}` : 'Autopilot is off. No more scheduled posts until you turn it on.', { only: chat.chatId });
}

async function cmdRun(chat) {
  try {
    const job = await startAutopilotPost('Telegram');
    return sendToChats(`Started a post: <b>${esc(job.input.topic)}</b>\nYou'll get a message when it is published or needs approval.`, { only: chat.chatId });
  } catch (err) {
    return sendToChats(`Could not start a post: ${esc(err.message)}`, { only: chat.chatId });
  }
}

// /site https://example.com [sponsored] [notes]: an AI article about a website.
// The draft comes back here for approval like other AI articles.
async function cmdSite(chat, args) {
  const user = await User.findOne({ _id: chat.user, active: true });
  if (!user || !['admin', 'editor'].includes(user.role)) return sendToChats('The blog account linked to this chat cannot start AI articles.', { only: chat.chatId });
  let [address, ...rest] = args;
  if (!address) return sendToChats('Send the website address after /site, for example:\n/site https://example.com\n/site https://example.com sponsored focus on the pricing plans', { only: chat.chatId });
  if (!/^https?:\/\//i.test(address)) address = `https://${address}`;
  let url;
  try {
    url = new URL(address);
    if (!url.hostname.includes('.')) throw new Error('no domain');
  } catch {
    return sendToChats(`"${esc(address)}" is not a website address.`, { only: chat.chatId });
  }
  const sponsored = /^sponsored$/i.test(rest[0] || '');
  if (sponsored) rest = rest.slice(1);
  try {
    const job = await startAiJob({ siteUrl: url.toString(), sponsored, instructions: rest.join(' ').slice(0, 3000) }, { user });
    return sendToChats(
      `🌐 Reading <b>${esc(url.hostname)}</b> and writing an article about it${sponsored ? ' (sponsored)' : ''}. It usually takes 5–10 minutes; the draft will come here for approval.\nJob: ${esc(String(job._id))}`,
      { only: chat.chatId },
    );
  } catch (err) {
    if (err instanceof JobStartError) return sendToChats(`Could not start: ${esc(err.message)}`, { only: chat.chatId });
    throw err;
  }
}

async function linkChat(msg, code) {
  const chatId = String(msg.chat.id);
  const fromId = String(msg.from?.id || msg.chat.id);
  const now = new Date();
  // Claim the code atomically so it works only once.
  const doc = await TelegramBot.findOneAndUpdate(
    { key: 'telegram', 'linkCode.code': code, 'linkCode.expiresAt': { $gt: now } },
    { $unset: { linkCode: 1 } },
    { new: false },
  );
  if (!doc) return false;
  const title = msg.chat.title || [msg.chat.first_name, msg.chat.last_name].filter(Boolean).join(' ') || msg.chat.username || chatId;
  await TelegramBot.updateOne({ key: 'telegram' }, { $pull: { chats: { chatId } } });
  await TelegramBot.updateOne({ key: 'telegram' }, { $push: { chats: { chatId, fromId, title: title.slice(0, 120), user: doc.linkCode.user, linkedAt: now } } });
  const user = await User.findById(doc.linkCode.user);
  await logActivity({ user: user || { _id: doc.linkCode.user, name: 'Telegram' } }, 'telegram.linked', { summary: `Telegram chat "${title}" linked` });
  return true;
}

// Shows the result of "New photo": the photo in the message is swapped for
// the new one (buttons kept), or a new photo message is sent.
async function afterNewCover(token, chatId, message, result) {
  if (!result.ok) {
    await tg(token, 'sendMessage', { chat_id: chatId, text: `⚠️ ${esc(result.text)}`, parse_mode: 'HTML', disable_web_page_preview: true }).catch(() => {});
    return;
  }
  const photo = await coverUrl(result.article);
  const buttons = { inline_keyboard: await postButtons(result.article) };
  const caption = `${articleSummary(result.article)}\n\n<i>${esc(result.text)}</i>`.slice(0, 1024);
  if (photo && message?.photo) {
    const swapped = await tg(token, 'editMessageMedia', { chat_id: chatId, message_id: message.message_id, media: { type: 'photo', media: photo, caption, parse_mode: 'HTML' }, reply_markup: buttons }).then(
      () => true,
      () => false,
    );
    if (swapped) return;
  }
  if (photo) {
    const ok = await tg(token, 'sendPhoto', { chat_id: chatId, photo, caption, parse_mode: 'HTML', reply_markup: buttons }).then(
      () => true,
      () => false,
    );
    if (ok) return;
  }
  // No public address for the photo (or Telegram could not fetch it): text with buttons.
  await tg(token, 'sendMessage', { chat_id: chatId, text: caption, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: buttons }).catch(() => {});
}

/** Handles one update from Telegram (a message or a button press). */
export async function handleUpdate(update) {
  const { doc, token } = await load();
  if (!token) return;
  const reply = (chatId, text) => tg(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });

  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = String(cq.message?.chat?.id || '');
    const chat = doc.chats.find((c) => c.chatId === chatId);
    const [action, id] = String(cq.data || '').split(':');
    let result;
    if (!chat || String(cq.from?.id) !== chat.fromId) result = { ok: false, text: 'Only the person who linked this chat can approve posts.' };
    else if (!['a', 'r', 'u', 'd', 'p'].includes(action) || !/^[a-f0-9]{24}$/i.test(id || '')) result = { ok: false, text: 'Unknown button.' };
    else if (action === 'p') {
      // Searching can take a few seconds: acknowledge the press first.
      await tg(token, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'Looking for a new photo…' }).catch(() => {});
      result = await newCover(id, chat);
      await afterNewCover(token, chatId, cq.message, result);
      return;
    } else result = await decide(id, action, chat);
    await tg(token, 'answerCallbackQuery', { callback_query_id: cq.id, text: result.text.slice(0, 190), show_alert: !result.ok }).catch(() => {});
    if (result.ok && cq.message) {
      // Photo messages carry their text as a caption.
      const isPhoto = Boolean(cq.message.photo);
      const body = esc((isPhoto ? cq.message.caption : cq.message.text) || '');
      await tg(token, isPhoto ? 'editMessageCaption' : 'editMessageText', {
        chat_id: chatId,
        message_id: cq.message.message_id,
        ...(isPhoto ? { caption: `${body.slice(0, 900)}\n\n<b>${esc(result.text)}</b>` } : { text: `${body.slice(0, 3500)}\n\n<b>${esc(result.text)}</b>`, disable_web_page_preview: true }),
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [] },
      }).catch(() => {});
    }
    return;
  }

  const msg = update.message;
  if (!msg?.chat || typeof msg.text !== 'string') return;
  const chatId = String(msg.chat.id);
  const [rawCmd, ...args] = msg.text.trim().split(/\s+/);
  const cmd = rawCmd.toLowerCase().replace(/@.*$/, '');

  if (cmd === '/start' && args[0]) {
    if (await linkChat(msg, args[0])) {
      await reply(chatId, `✅ Linked to <b>${esc((await SiteSettings.getSingleton()).siteName)}</b>. You'll get notifications here and can approve posts with the buttons.\n\n${HELP}`);
    } else {
      await reply(chatId, 'That link code is wrong or has expired. Create a new one in the blog admin under Telegram.');
    }
    return;
  }
  const chat = doc.chats.find((c) => c.chatId === chatId);
  if (!chat || String(msg.from?.id || chatId) !== chat.fromId) {
    await reply(chatId, 'This is a private bot for a blog. To use it, open the blog admin → Telegram and click "Link my Telegram".');
    return;
  }
  // A website address on its own: write about that website.
  if (/^https?:\/\/\S+$/i.test(msg.text.trim())) {
    await cmdSite(chat, [msg.text.trim()]);
    return;
  }
  switch (cmd) {
    case '/site':
      await cmdSite(chat, args);
      break;
    case '/pending':
      await cmdPending(chatId);
      break;
    case '/recent':
      await cmdRecent(chatId);
      break;
    case '/status':
      await cmdStatus(chatId);
      break;
    case '/stats':
      await cmdStats(chatId);
      break;
    case '/run':
      await cmdRun(chat);
      break;
    case '/autopilot_on':
      await setAutopilot(true, chat);
      break;
    case '/autopilot_off':
      await setAutopilot(false, chat);
      break;
    case '/unlink':
      await TelegramBot.updateOne({ key: 'telegram' }, { $pull: { chats: { chatId } } });
      await reply(chatId, 'This chat is unlinked. You will not get more messages here.');
      break;
    default:
      await reply(chatId, HELP);
  }
}

// ---------- Daily summary ----------
function localParts(now, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** Sends the daily summary once a day after the chosen time. Returns true when sent. */
export async function maybeSendDailySummary(now = new Date()) {
  const doc = await TelegramBot.findOne({ key: 'telegram' }).lean();
  if (!doc?.enabled || !doc.chats?.length || doc.notify?.dailySummary === false) return false;
  const s = await SiteSettings.getSingleton();
  const tz = s.autopilot?.timezone || 'UTC';
  const { day, time } = localParts(now, tz);
  if (time < (doc.summaryTime || '21:00') || doc.lastSummaryDay === day) return false;
  const claimed = await TelegramBot.updateOne({ key: 'telegram', lastSummaryDay: { $ne: day } }, { $set: { lastSummaryDay: day } });
  if (claimed.modifiedCount !== 1) return false;

  const since = new Date(now.getTime() - 24 * 3600 * 1000);
  const [published, pending, jobs, overview] = await Promise.all([
    Article.find({ status: 'published', publishedAt: { $gte: since, $lte: now } }).select('title').lean(),
    Article.countDocuments({ status: 'pending_approval' }),
    ResearchJob.countDocuments({ 'autopilot.enabled': true, createdAt: { $gte: since } }),
    analyticsOverview(7),
  ]);
  const top = overview.mostRead[0] || overview.mostViewed[0];
  const lines = [
    `📊 <b>Daily summary</b> – ${esc(s.siteName)}`,
    '',
    `Published in the last 24 hours: ${published.length}${published.length ? `\n${published.slice(0, 6).map((a) => `• ${esc(a.title)}`).join('\n')}` : ''}`,
    `Autopilot posts started: ${jobs}`,
    `Waiting for approval: ${pending}${pending ? ' (send /pending)' : ''}`,
    `Visitors, last 7 days: ${overview.totals.views} views, ${overview.totals.reads} reads`,
    top ? `Most read: ${esc(top.title)}` : '',
    s.autopilot?.enabled ? `Next Autopilot post: ${timeIn(s.autopilot.nextRunAt, tz)}` : 'Autopilot is off.',
  ];
  await sendToChats(lines.filter((l) => l !== '').join('\n').replace('\n\n\n', '\n\n'));
  return true;
}

// ---------- Linking and polling ----------
export async function createLinkCode(userId) {
  const code = crypto.randomBytes(9).toString('base64url');
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  await TelegramBot.updateOne({ key: 'telegram' }, { $set: { linkCode: { code, user: userId, expiresAt } } }, { upsert: true });
  return { code, expiresAt };
}

/** Polls Telegram for messages and button presses while the bot is enabled. */
export function startTelegramBot() {
  let stopped = false;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms).unref?.());
  (async () => {
    while (!stopped) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const { doc, token } = await load();
        if (!doc.enabled || !token) {
          // eslint-disable-next-line no-await-in-loop
          await sleep(15000);
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        await maybeSendDailySummary().catch((err) => logger.warn({ err: err.message }, 'Telegram daily summary failed'));
        // eslint-disable-next-line no-await-in-loop
        const updates = await tg(token, 'getUpdates', { offset: doc.updateOffset || 0, timeout: 25, allowed_updates: ['message', 'callback_query'] }, 40000);
        for (const u of updates) {
          // eslint-disable-next-line no-await-in-loop
          await handleUpdate(u).catch((err) => logger.warn({ err: err.message }, 'Telegram update failed'));
          // eslint-disable-next-line no-await-in-loop
          await TelegramBot.updateOne({ key: 'telegram' }, { $set: { updateOffset: u.update_id + 1 } });
        }
        // eslint-disable-next-line no-await-in-loop
        await TelegramBot.updateOne({ key: 'telegram' }, { $set: { lastPollAt: new Date(), lastError: '' } });
      } catch (err) {
        logger.warn({ err: err.message }, 'Telegram polling failed');
        // eslint-disable-next-line no-await-in-loop
        await recordError(err);
        // eslint-disable-next-line no-await-in-loop
        await sleep(err instanceof TelegramError && err.retryAfter ? err.retryAfter * 1000 : 15000);
      }
    }
  })();
  return () => {
    stopped = true;
  };
}
