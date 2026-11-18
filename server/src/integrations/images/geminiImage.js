import { AiError } from '../ai/errors.js';
import { geminiCall } from '../ai/gemini.js';
import { imageFromBase64 } from './common.js';

// Gemini native image generation ("Nano Banana" models) with the Gemini API key.
// Image output is billed: the Gemini API has no free tier for it.
// Docs: https://ai.google.dev/gemini-api/docs/image-generation
const NAME = 'Gemini image';
export const kind = 'generate';

export async function listModels({ apiKey }) {
  const out = [];
  let pageToken = '';
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const data = await geminiCall(`/models?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, { apiKey, timeoutMs: 20000 });
    for (const m of data?.models || []) {
      const id = String(m.name || '').replace(/^models\//, '');
      if (!id.startsWith('gemini') || !/image/i.test(id) || !(m.supportedGenerationMethods || []).includes('generateContent')) continue;
      out.push({ id, name: m.displayName || id });
    }
    pageToken = data?.nextPageToken;
    if (!pageToken) break;
  }
  return out.sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
}

export async function generate({ apiKey, model, prompt, timeoutMs = 180000 }) {
  if (!model) throw new AiError('No Gemini image model is selected. Choose one in AI Providers.', { code: 'no_model' });
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '16:9' } },
  };
  const data = await geminiCall(`/models/${encodeURIComponent(model)}:generateContent`, { apiKey, method: 'POST', body, timeoutMs });
  if (data?.promptFeedback?.blockReason) throw new AiError(`Gemini blocked the image prompt (${data.promptFeedback.blockReason}).`, { code: 'blocked' });
  const cand = data?.candidates?.[0];
  const part = (cand?.content?.parts || []).find((p) => p.inlineData?.data || p.inline_data?.data);
  if (!part) {
    const reason = cand?.finishReason || 'no image';
    throw new AiError(`Gemini returned no image (${reason}).`, { code: /SAFETY|PROHIBITED|BLOCK|IMAGE_SAFETY/.test(reason) ? 'blocked' : 'empty', retryable: !/SAFETY|PROHIBITED|BLOCK/.test(reason) });
  }
  return { ...imageFromBase64(NAME, (part.inlineData || part.inline_data).data), providerLabel: model };
}

export async function testConnection({ apiKey, model }) {
  const models = await listModels({ apiKey });
  if (!model) return { ok: true, message: `Key works. ${models.length} Gemini image models available; choose one.` };
  if (!models.some((m) => m.id === model)) return { ok: false, message: `Key works, but the image model "${model}" is not available to this key.` };
  return { ok: true, message: `Key works and "${model}" is available. Image generation needs billing enabled on the Google project; no test image was made.` };
}
