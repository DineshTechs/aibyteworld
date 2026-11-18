import { AiError, withRetry } from './errors.js';

// Google Gemini adapter (Gemini API, generateContent endpoint).
// Docs: https://ai.google.dev/gemini-api/docs
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

function parseRetryDelay(body, headers) {
  const header = Number(headers?.get?.('retry-after'));
  if (header > 0) return header * 1000;
  const details = body?.error?.details || [];
  const info = details.find((d) => String(d['@type'] || '').includes('RetryInfo'));
  const m = String(info?.retryDelay || '').match(/^([\d.]+)s$/);
  return m ? Math.ceil(Number(m[1]) * 1000) : 0;
}

async function call(path, { apiKey, method = 'GET', body, timeoutMs = 120000 }) {
  if (!apiKey) throw new AiError('No Gemini API key is configured. Add one in AI Providers.', { code: 'no_key' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'x-goog-api-key': apiKey, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    const timedOut = err?.name === 'AbortError';
    throw new AiError(timedOut ? `Gemini did not respond within ${Math.round(timeoutMs / 1000)} seconds` : `Could not reach Gemini: ${err.message}`, {
      retryable: true,
      code: timedOut ? 'timeout' : 'network',
    });
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    if (res.status === 400 && /api key/i.test(msg)) throw new AiError('Gemini rejected the API key. Check it in AI Providers.', { status: 400, code: 'auth' });
    if (res.status === 401 || res.status === 403) throw new AiError(`Gemini refused the request: ${msg}`, { status: res.status, code: 'auth' });
    if (res.status === 404) throw new AiError(`Gemini model or endpoint not found: ${msg}`, { status: 404, code: 'not_found' });
    if (res.status === 429) {
      // QuotaFailure says which quota ran out. A limit of 0 (feature not in
      // this plan) or a daily limit will not recover by retrying now.
      const violations = (data?.error?.details || []).filter((d) => String(d['@type'] || '').includes('QuotaFailure')).flatMap((d) => d.violations || []);
      const v = violations[0];
      if (v) {
        const id = v.quotaId || v.quotaMetric || 'unknown quota';
        const limit = v.quotaValue !== undefined ? String(v.quotaValue) : '';
        const hard = limit === '0' || /PerDay|per_day|daily/i.test(`${v.quotaId} ${v.quotaMetric}`);
        const detail = `${id}${v.quotaDimensions?.model ? ` for ${v.quotaDimensions.model}` : ''}${limit ? `, limit ${limit}` : ''}`;
        if (hard) {
          const why = limit === '0' ? 'This API key\'s plan includes none of this quota' : 'The daily quota is used up';
          throw new AiError(`Gemini quota exceeded (${detail}). ${why}; retrying now will not help. Check plan and billing at https://aistudio.google.com/usage`, { status: 429, code: 'quota' });
        }
        throw new AiError(`Gemini rate limit reached (${detail}).`, { status: 429, retryable: true, retryAfterMs: parseRetryDelay(data, res.headers), code: 'rate_limit' });
      }
      throw new AiError(`Gemini rate limit or quota reached: ${msg}`, { status: 429, retryable: true, retryAfterMs: parseRetryDelay(data, res.headers), code: 'rate_limit' });
    }
    if (res.status >= 500) throw new AiError(`Gemini server error (${res.status}): ${msg}`, { status: res.status, retryable: true, code: 'server' });
    throw new AiError(`Gemini request failed: ${msg}`, { status: res.status, code: 'bad_request' });
  }
  return data;
}

export async function listModels({ apiKey }) {
  const out = [];
  let pageToken = '';
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const data = await call(`/models?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, { apiKey, timeoutMs: 20000 });
    for (const m of data?.models || []) {
      const id = String(m.name || '').replace(/^models\//, '');
      if (!id.startsWith('gemini') || !(m.supportedGenerationMethods || []).includes('generateContent')) continue;
      // Text generation models only.
      if (/embedding|image|tts|audio|live|robotics|computer-use|transcribe|nano-banana|customtools/i.test(id)) continue;
      out.push({ id, name: m.displayName || id, inputTokenLimit: m.inputTokenLimit, outputTokenLimit: m.outputTokenLimit });
    }
    pageToken = data?.nextPageToken;
    if (!pageToken) break;
  }
  return out.sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
}

// Strips ``` fences that models sometimes add around JSON or HTML.
export function stripFences(text) {
  return String(text || '')
    .trim()
    .replace(/^```[a-zA-Z]*\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim();
}

/**
 * One model call.
 * @returns {{ text, json, grounding, usage, finishReason }}
 *   grounding: { queries[], suggestionsHtml, chunks:[{uri,title}], supports:[{text,chunkIndices[],confidence}] } | null
 */
export async function generate({ apiKey, model, system, prompt, json = false, googleSearch = false, webSearch = false, temperature = 0.4, maxOutputTokens = 8192, timeoutMs = 180000 }) {
  if (!model) throw new AiError('No Gemini model is selected. Choose one in AI Providers.', { code: 'no_model' });
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature, maxOutputTokens, ...(json ? { responseMimeType: 'application/json' } : {}) },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (googleSearch || webSearch) body.tools = [{ google_search: {} }];

  const data = await call(`/models/${encodeURIComponent(model)}:generateContent`, { apiKey, method: 'POST', body, timeoutMs });

  if (data?.promptFeedback?.blockReason) {
    throw new AiError(`Gemini blocked the request (${data.promptFeedback.blockReason}). Rephrase the topic or instructions.`, { code: 'blocked' });
  }
  const cand = data?.candidates?.[0];
  const finishReason = cand?.finishReason || '';
  const text = (cand?.content?.parts || [])
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('');
  if (!text) {
    const reason = finishReason || 'no content';
    const retryable = !['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII'].includes(reason);
    throw new AiError(`Gemini returned no text (${reason}).`, { retryable, code: 'empty' });
  }
  if (finishReason === 'MAX_TOKENS' && json) {
    throw new AiError('Gemini stopped before finishing its answer (output limit reached).', { retryable: true, code: 'max_tokens' });
  }

  let parsed;
  if (json) {
    try {
      parsed = JSON.parse(stripFences(text));
    } catch {
      throw new AiError('Gemini returned malformed JSON.', { retryable: true, code: 'bad_json' });
    }
  }

  const gm = cand?.groundingMetadata;
  const grounding = gm
    ? {
        queries: gm.webSearchQueries || [],
        suggestionsHtml: gm.searchEntryPoint?.renderedContent || '',
        chunks: (gm.groundingChunks || []).map((c) => ({ uri: c.web?.uri || '', title: c.web?.title || '' })),
        supports: (gm.groundingSupports || []).map((s) => ({
          text: s.segment?.text || '',
          chunkIndices: s.groundingChunkIndices || [],
          confidence: Array.isArray(s.confidenceScores) && s.confidenceScores.length ? Math.max(...s.confidenceScores) : null,
        })),
      }
    : null;

  const u = data?.usageMetadata || {};
  return {
    text,
    json: parsed,
    grounding,
    finishReason,
    usage: { promptTokens: u.promptTokenCount || 0, outputTokens: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) },
  };
}

export async function testConnection({ apiKey, model }) {
  const models = await listModels({ apiKey });
  if (!model) return { ok: true, message: `Key works. ${models.length} Gemini models available; choose one.`, models };
  if (!models.some((m) => m.id === model)) {
    return { ok: false, message: `Key works, but the model "${model}" is not available to this key.`, models };
  }
  // Brief capacity errors (429/503) are common; retry a couple of times like real jobs do.
  await withRetry(() => generate({ apiKey, model, prompt: 'Reply with the single word OK.', maxOutputTokens: 256, timeoutMs: 30000 }), { retries: 2, baseMs: 3000, maxMs: 10000 });
  return { ok: true, message: `Connected. "${model}" answered a test prompt.`, models };
}

export const BASE_URL = BASE;
// Raw API call with Gemini's error mapping (used by the image adapter).
export { call as geminiCall };
