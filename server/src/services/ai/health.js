import { logger } from '../../config/logger.js';
import { AIProvider } from '../../models/index.js';

// Remembers recent provider failures so every call starts with the best
// provider that is likely to work. A failed provider "cools down" for a while
// (longer for a used-up quota than for a per-minute rate limit) and is then
// tried first again, so the best provider is used again as soon as it recovers.
// State lives in memory (one server process) and is mirrored to the database
// so it survives restarts and can be shown on the AI Providers page.

const MIN = 60 * 1000;
const mem = new Map(); // `${key}:${role}` -> { until, code, message, at }
let loaded = null;

export function cooldownMs(err) {
  switch (err?.code) {
    case 'rate_limit':
      return Math.min(15 * MIN, Math.max(MIN, err.retryAfterMs || 0));
    case 'quota':
      return 60 * MIN; // daily quota or no credit: check again in an hour
    case 'auth':
    case 'no_key':
    case 'no_model':
    case 'not_found':
      return 30 * MIN; // cleared at once when the key or model is changed
    case 'server':
    case 'timeout':
    case 'network':
      return 3 * MIN;
    default:
      return 0; // problems with one answer (bad JSON, blocked prompt): no cooldown
  }
}

async function ensureLoaded() {
  if (!loaded) {
    loaded = AIProvider.find({}, 'key health')
      .lean()
      .then((docs) => {
        const now = Date.now();
        for (const d of docs) {
          for (const [role, h] of Object.entries(d.health || {})) {
            const until = new Date(h?.until).getTime();
            if (until > now) mem.set(`${d.key}:${role}`, { until, code: h.code || '', message: h.message || '', at: new Date(h.at).getTime() || now });
          }
        }
      })
      .catch((err) => {
        logger.warn({ err: err.message }, 'Could not load provider health');
      });
  }
  await loaded;
}

export function coolingInfo(key, role) {
  const h = mem.get(`${key}:${role}`);
  if (!h) return null;
  if (h.until <= Date.now()) {
    mem.delete(`${key}:${role}`);
    return null;
  }
  return h;
}

export async function markFailure(key, role, err) {
  const ms = cooldownMs(err);
  if (!ms) return null;
  const h = { until: Date.now() + ms, code: err.code || '', message: String(err.message || '').slice(0, 300), at: Date.now() };
  mem.set(`${key}:${role}`, h);
  await AIProvider.updateOne(
    { key },
    { $set: { [`health.${role}`]: { until: new Date(h.until), code: h.code, message: h.message, at: new Date(h.at) } } },
    { upsert: true },
  ).catch(() => {});
  return h;
}

export async function markSuccess(key, role) {
  if (!mem.has(`${key}:${role}`)) return;
  mem.delete(`${key}:${role}`);
  await AIProvider.updateOne({ key }, { $unset: { [`health.${role}`]: 1 } }).catch(() => {});
}

// "Try now" on the AI Providers page, and after a key or model change.
export async function clearHealth(key) {
  for (const k of [...mem.keys()]) if (k.startsWith(`${key}:`)) mem.delete(k);
  await AIProvider.updateOne({ key }, { $set: { health: {} } }).catch(() => {});
}

// Tests only.
export async function resetAllHealth() {
  mem.clear();
  loaded = null;
  await AIProvider.updateMany({}, { $set: { health: {} } }).catch(() => {});
}

// What the AI Providers page shows: roles that are cooling down now.
export async function healthView(key) {
  await ensureLoaded();
  const out = [];
  for (const role of ['research', 'writer', 'image']) {
    const h = coolingInfo(key, role);
    if (h) out.push({ role, until: new Date(h.until).toISOString(), code: h.code, message: h.message });
  }
  return out;
}

// Providers in the order to try them now: those that are not cooling down
// keep their (quality) order; cooling ones go last, soonest-ready first, so
// they are still tried if everything else fails.
export async function orderForNow(chain, role) {
  await ensureLoaded();
  const fresh = [];
  const cooling = [];
  for (const p of chain) {
    const h = coolingInfo(p.key, role);
    if (h) cooling.push({ p, h });
    else fresh.push(p);
  }
  cooling.sort((a, b) => a.h.until - b.h.until);
  return { order: [...fresh, ...cooling.map((c) => c.p)], cooling };
}
