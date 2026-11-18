import { AiError } from '../ai/errors.js';
import { requestJson } from '../ai/http.js';
import { imageFromBase64 } from './common.js';

// Cloudflare Workers AI, FLUX.1 [schnell]. Free daily allowance of 10,000
// neurons (resets 00:00 UTC). Needs an API token with Workers AI permission
// and the account ID.
// Docs: https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/
const NAME = 'Cloudflare Workers AI';
export const kind = 'generate';
export const MODEL = '@cf/black-forest-labs/flux-1-schnell';

const mapError = (res, data, msg) => {
  const text = `${msg} ${JSON.stringify(data?.errors || '')}`;
  if (/daily free allocation|neurons|used up|exceeded/i.test(text) && (res.status === 429 || res.status === 400 || res.status === 403)) {
    return new AiError(`Cloudflare free daily allowance used up: ${msg}`, { status: res.status, code: 'quota' });
  }
  if (res.status === 400 && /nsfw|safety|flagged/i.test(text)) return new AiError(`Cloudflare declined this image prompt: ${msg}`, { status: 400, code: 'blocked' });
  return null;
};

const base = (accountId) => {
  if (!/^[a-f0-9]{32}$/i.test(String(accountId || ''))) throw new AiError('Cloudflare account ID is missing or invalid. Add it in AI Providers.', { code: 'no_key' });
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai`;
};

const message = (data, fallback) => (data?.errors || []).map((e) => e.message).join('; ') || fallback;

export async function generate({ apiKey, accountId, prompt, timeoutMs = 120000 }) {
  if (!apiKey) throw new AiError('No Cloudflare API token is configured. Add one in AI Providers.', { code: 'no_key' });
  const data = await requestJson(NAME, `${base(accountId)}/run/${MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: { prompt: prompt.slice(0, 2048), steps: 8 },
    timeoutMs,
    mapError,
  });
  if (data?.success === false) throw new AiError(`Cloudflare request failed: ${message(data, 'unknown error')}`, { code: 'bad_request' });
  return { ...imageFromBase64(NAME, data?.result?.image), providerLabel: 'FLUX.1 schnell' };
}

export async function testConnection({ apiKey, accountId }) {
  if (!apiKey) return { ok: false, message: 'Add an API token first.' };
  const data = await requestJson(NAME, `${base(accountId)}/models/search?search=flux-1-schnell&per_page=5`, { headers: { Authorization: `Bearer ${apiKey}` }, timeoutMs: 20000, mapError });
  if (data?.success === false) return { ok: false, message: message(data, 'Cloudflare refused the request.') };
  return { ok: true, message: 'Token and account ID work. FLUX.1 schnell is free up to the daily allowance; no test image was made.' };
}
