import { AiError } from '../ai/errors.js';
import { requestJson } from '../ai/http.js';
import { imageFromBase64 } from './common.js';

// OpenAI image generation (Images API). Uses the OpenAI API key.
// Docs: https://developers.openai.com/api/docs/guides/image-generation
const BASE = 'https://api.openai.com/v1';
const NAME = 'OpenAI Images';
export const kind = 'generate';

const mapError = (res, data, msg) => {
  const code = data?.error?.code || data?.error?.type || '';
  if (res.status === 429 && code === 'insufficient_quota') return new AiError(`OpenAI has no credit or quota left: ${msg}`, { status: 429, code: 'quota' });
  if (res.status === 400 && /safety|moderation|content policy/i.test(msg)) return new AiError(`OpenAI declined this image prompt: ${msg}`, { status: 400, code: 'blocked' });
  if (res.status === 403 && /verif/i.test(msg)) return new AiError(`OpenAI requires organization verification for this image model: ${msg}`, { status: 403, code: 'auth' });
  return null;
};

const call = (path, { apiKey, ...opts }) => {
  if (!apiKey) throw new AiError('No OpenAI API key is configured. Add one in AI Providers.', { code: 'no_key' });
  return requestJson('OpenAI', `${BASE}${path}`, { ...opts, headers: { Authorization: `Bearer ${apiKey}` }, mapError });
};

export async function listModels({ apiKey }) {
  const data = await call('/models', { apiKey, timeoutMs: 20000 });
  return (data?.data || [])
    .map((m) => m.id)
    .filter((id) => /^(gpt-image|dall-e-3)/.test(id))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((id) => ({ id, name: id }));
}

export async function generate({ apiKey, model, prompt, timeoutMs = 180000 }) {
  if (!model) throw new AiError('No OpenAI image model is selected. Choose one in AI Providers.', { code: 'no_model' });
  const body = model.startsWith('dall-e')
    ? { model, prompt, n: 1, size: '1792x1024', response_format: 'b64_json' }
    : { model, prompt, n: 1, size: '1536x1024', quality: 'medium', output_format: 'jpeg', output_compression: 85 };
  const data = await call('/images/generations', { apiKey, method: 'POST', body, timeoutMs });
  return { ...imageFromBase64(NAME, data?.data?.[0]?.b64_json), providerLabel: model };
}

// Checks the key and model without generating (each image is billed).
export async function testConnection({ apiKey, model }) {
  const models = await listModels({ apiKey });
  if (!model) return { ok: true, message: `Key works. ${models.length} image models available; choose one.` };
  if (!models.some((m) => m.id === model)) return { ok: false, message: `Key works, but the image model "${model}" is not available to this key.` };
  return { ok: true, message: `Key works and "${model}" is available. No test image was made, because each one is billed.` };
}
