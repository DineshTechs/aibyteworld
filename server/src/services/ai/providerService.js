import { env } from '../../config/env.js';
import { PROVIDER_INFO, qualityScore } from '../../integrations/ai/index.js';
import { AIProvider } from '../../models/index.js';
import { decryptSecret } from '../../utils/crypto.js';

async function keyOf(key) {
  const info = PROVIDER_INFO[key];
  const doc = await AIProvider.findOne({ key }).select('+apiKey.iv +apiKey.tag +apiKey.data');
  let apiKey = doc?.apiKey?.data ? decryptSecret(doc.apiKey) : '';
  let keySource = apiKey ? 'dashboard' : 'none';
  if (!apiKey && info?.envVar && env[info.envVar]) {
    apiKey = env[info.envVar];
    keySource = 'env';
  }
  return { doc, apiKey, keySource };
}

// Returns a provider's settings with its decrypted key (server-side only:
// keys never go into an API response). A provider with `keyFrom` may use
// another provider's key when it has none of its own.
export async function getActiveProvider(key) {
  const info = PROVIDER_INFO[key];
  let { doc, apiKey, keySource } = await keyOf(key);
  if (!apiKey && info?.keyFrom) {
    const shared = await keyOf(info.keyFrom);
    if (shared.apiKey) {
      apiKey = shared.apiKey;
      keySource = `shared:${info.keyFrom}`;
    }
  }
  if (info?.keyless) keySource = 'not_needed';
  const baseUrl = key === 'ollama' ? doc?.baseUrl || env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434' : undefined;
  return { key, info, doc, apiKey, keySource, baseUrl, model: doc?.model || '', enabled: doc ? doc.enabled : true };
}

export function isReady(p) {
  return Boolean(p.enabled && (p.model || p.info?.modelless) && (p.apiKey || p.info?.keyless));
}

export function notReadyReason(p) {
  if (!p.enabled) return `${p.info.name} is disabled`;
  if (!p.apiKey && !p.info?.keyless) return `${p.info.name} has no API key`;
  if (!p.model && !p.info?.modelless) return `${p.info.name} has no model chosen`;
  return '';
}

const LISTS = { research: 'researchProviders', writer: 'writerProviders', image: 'imageProviders' };

export function fitsRole(key, role) {
  const info = PROVIDER_INFO[key];
  if (!info) return false;
  if (role === 'image') return info.kind === 'image';
  if (info.kind === 'image') return false;
  if (role === 'research') return Boolean(info.supportsWebSearch);
  return !info.searchOnly;
}

// The ordered, ready providers for a role: "research" (web search), "writer"
// or "image". With orderMode "quality" (the default) the best provider comes
// first, whatever position it has in the list; ties keep the admin's order.
export async function providerChain(settings, role) {
  const keys = settings[LISTS[role]] || [];
  const out = [];
  const skipped = [];
  for (const key of keys) {
    if (!fitsRole(key, role)) continue;
    // eslint-disable-next-line no-await-in-loop
    const p = await getActiveProvider(key);
    if (isReady(p)) out.push(p);
    else skipped.push(notReadyReason(p));
  }
  if (settings.orderMode !== 'custom') out.sort((a, b) => qualityScore(b.key, b.model) - qualityScore(a.key, a.model));
  return { chain: out, skipped };
}
