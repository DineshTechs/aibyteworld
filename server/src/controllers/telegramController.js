import { z } from 'zod';
import { tg } from '../integrations/telegram.js';
import { SiteSettings, TelegramBot } from '../models/index.js';
import { logActivity } from '../services/activityService.js';
import { createLinkCode, registerCommands, sendToChats } from '../services/telegram/bot.js';
import { encryptSecret } from '../utils/crypto.js';
import { asyncHandler, badRequest, notFound } from '../utils/http.js';
import { tgEscape } from '../integrations/telegram.js';

const NOTIFY_KEYS = ['started', 'held', 'review', 'submitted', 'published', 'failed', 'problems', 'system', 'dailySummary'];

async function view() {
  const doc = await TelegramBot.getSingleton();
  await doc.populate({ path: 'chats.user', select: 'name role' });
  const code = doc.linkCode?.code && doc.linkCode.expiresAt > new Date() ? doc.linkCode : null;
  return {
    enabled: doc.enabled,
    hasToken: Boolean(doc.tokenLast4),
    tokenLast4: doc.tokenLast4,
    botUsername: doc.botUsername,
    botLink: doc.botUsername ? `https://t.me/${doc.botUsername}` : '',
    chats: doc.chats.map((c) => ({ chatId: c.chatId, title: c.title, user: c.user ? { name: c.user.name, role: c.user.role } : null, linkedAt: c.linkedAt })),
    notify: Object.fromEntries(NOTIFY_KEYS.map((k) => [k, doc.notify?.[k] !== false])),
    summaryTime: doc.summaryTime,
    timezone: (await SiteSettings.getSingleton()).autopilot?.timezone || 'UTC',
    linkCode: code ? { code: code.code, expiresAt: code.expiresAt, link: doc.botUsername ? `https://t.me/${doc.botUsername}?start=${code.code}` : '' } : null,
    lastPollAt: doc.lastPollAt || null,
    lastError: doc.lastError,
  };
}

export const telegramSchema = z.object({
  enabled: z.boolean().optional(),
  token: z
    .string()
    .trim()
    .regex(/^\d{5,15}:[A-Za-z0-9_-]{30,60}$/, 'A bot token looks like 123456789:AAH... (copy it from @BotFather)')
    .optional(),
  notify: z.object(Object.fromEntries(NOTIFY_KEYS.map((k) => [k, z.boolean().optional()]))).optional(),
  summaryTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 21:00')
    .optional(),
});

export const getTelegram = asyncHandler(async (_req, res) => {
  res.json(await view());
});

export const updateTelegram = asyncHandler(async (req, res) => {
  const doc = await TelegramBot.getSingleton();
  const b = req.body;
  const changes = [];
  if (b.token) {
    let me;
    try {
      me = await tg(b.token, 'getMe');
    } catch (err) {
      throw badRequest(err.message);
    }
    // Polling needs the webhook removed; harmless when there is none.
    await tg(b.token, 'deleteWebhook', { drop_pending_updates: false }).catch(() => {});
    await registerCommands(b.token); // the "/" command menu in Telegram
    doc.token = encryptSecret(b.token);
    doc.tokenLast4 = b.token.slice(-4);
    if (doc.botUsername && doc.botUsername !== me.username) doc.chats = []; // a different bot cannot reach the old chats
    doc.botUsername = me.username || '';
    doc.updateOffset = 0;
    doc.lastError = '';
    if (b.enabled === undefined) doc.enabled = true;
    changes.push(`bot @${me.username} connected`);
  }
  if (b.enabled !== undefined) {
    if (b.enabled && !doc.tokenLast4) throw badRequest('Add the bot token first.');
    if (b.enabled !== doc.enabled) changes.push(b.enabled ? 'turned on' : 'turned off');
    doc.enabled = b.enabled;
  }
  if (b.notify) {
    for (const k of NOTIFY_KEYS) if (b.notify[k] !== undefined) doc.notify[k] = b.notify[k];
    changes.push('notifications updated');
  }
  if (b.summaryTime) doc.summaryTime = b.summaryTime;
  await doc.save();
  if (changes.length) await logActivity(req, 'telegram.update', { summary: `Telegram: ${changes.join(', ')}` });
  res.json(await view());
});

export const removeTelegramToken = asyncHandler(async (req, res) => {
  await TelegramBot.updateOne({ key: 'telegram' }, { $unset: { token: 1, linkCode: 1 }, $set: { tokenLast4: '', botUsername: '', enabled: false, chats: [], updateOffset: 0, lastError: '' } });
  await logActivity(req, 'telegram.update', { summary: 'Telegram bot removed' });
  res.json(await view());
});

export const createTelegramLink = asyncHandler(async (req, res) => {
  const doc = await TelegramBot.getSingleton();
  if (!doc.tokenLast4) throw badRequest('Add the bot token first.');
  await createLinkCode(req.user._id);
  res.json(await view());
});

export const removeTelegramChat = asyncHandler(async (req, res) => {
  const chatId = String(req.params.chatId);
  // (modifiedCount is not used: the automatic updatedAt makes every update count as a change.)
  if (!(await TelegramBot.exists({ key: 'telegram', 'chats.chatId': chatId }))) throw notFound('That chat is not linked');
  await TelegramBot.updateOne({ key: 'telegram' }, { $pull: { chats: { chatId } } });
  await logActivity(req, 'telegram.update', { summary: 'Telegram chat unlinked' });
  res.json(await view());
});

export const testTelegram = asyncHandler(async (req, res) => {
  const doc = await TelegramBot.getSingleton();
  if (!doc.enabled || !doc.tokenLast4) throw badRequest('Turn the bot on and add a token first.');
  if (!doc.chats.length) throw badRequest('Link a chat first: click "Link my Telegram".');
  const site = (await SiteSettings.getSingleton()).siteName;
  const sent = await sendToChats(`🔔 Test message from <b>${tgEscape(site)}</b>. Notifications work.`);
  if (!sent) throw badRequest(`No message could be sent. ${(await TelegramBot.getSingleton()).lastError || ''}`.trim());
  res.json({ sent, ...(await view()) });
});
