import { AiError, withRetry } from './errors.js';
import { cleanCitedText, parseJsonText, requestJson } from './http.js';

// OpenAI adapter (Responses API). Research uses the hosted web_search tool;
// answers carry url_citation annotations that point at the sources.
// Docs: https://developers.openai.com/api/docs/guides/tools-web-search
const BASE = 'https://api.openai.com/v1';
const NAME = 'OpenAI';

const mapError = (res, data, msg) => {
  const code = data?.error?.code || data?.error?.type || '';
  if (res.status === 429 && code === 'insufficient_quota') {
    return new AiError(`OpenAI has no credit or quota left: ${msg}`, { status: 429, code: 'quota' });
  }
  return null;
};

const call = (path, { apiKey, ...opts }) => {
  if (!apiKey) throw new AiError('No OpenAI API key is configured. Add one in AI Providers.', { code: 'no_key' });
  return requestJson(NAME, `${BASE}${path}`, { ...opts, headers: { Authorization: `Bearer ${apiKey}` }, mapError });
};

export async function listModels({ apiKey }) {
  const data = await call('/models', { apiKey, timeoutMs: 20000 });
  return (data?.data || [])
    .map((m) => m.id)
    .filter((id) => /^(gpt-|o\d|chatgpt-)/.test(id) && !/audio|realtime|tts|transcribe|image|embedding|moderation|search-api|instruct|codex|computer-use|dall-e|whisper/.test(id))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((id) => ({ id, name: id }));
}

// Sentence that a citation marker belongs to: the text before start_index.
function sentenceBefore(text, start) {
  const before = text.slice(0, start).replace(/[\s(]+$/, '');
  const parts = before.split(/(?<=[.!?])\s+|\n+/);
  return cleanCitedText(parts[parts.length - 1] || '');
}

export async function generate({ apiKey, model, system, prompt, json = false, webSearch = false, googleSearch = false, maxOutputTokens = 8192, timeoutMs = 180000 }) {
  if (!model) throw new AiError('No OpenAI model is selected. Choose one in AI Providers.', { code: 'no_model' });
  const search = webSearch || googleSearch;
  const body = {
    model,
    input: prompt,
    max_output_tokens: maxOutputTokens,
    store: false,
    ...(system ? { instructions: system } : {}),
    ...(json ? { text: { format: { type: 'json_object' } } } : {}),
    ...(search ? { tools: [{ type: 'web_search' }], include: ['web_search_call.action.sources'] } : {}),
  };
  const data = await call('/responses', { apiKey, method: 'POST', body, timeoutMs });

  const messages = (data?.output || []).filter((o) => o.type === 'message');
  const parts = messages.flatMap((m) => m.content || []).filter((c) => c.type === 'output_text');
  const text = parts.map((p) => p.text).join('');
  const incomplete = data?.status === 'incomplete' ? data?.incomplete_details?.reason || 'incomplete' : '';
  if (!text) throw new AiError(`OpenAI returned no text${incomplete ? ` (${incomplete})` : ''}.`, { retryable: incomplete !== 'content_filter', code: 'empty' });
  if (json && incomplete === 'max_output_tokens') throw new AiError('OpenAI stopped before finishing its answer (output limit reached).', { retryable: true, code: 'max_tokens' });

  let grounding = null;
  if (search) {
    const calls = (data?.output || []).filter((o) => o.type === 'web_search_call');
    const queries = calls.flatMap((c) => c.action?.queries || (c.action?.query ? [c.action.query] : []));
    const chunks = [];
    const chunkIndex = new Map();
    const supportsByText = new Map();
    let offset = 0;
    for (const p of parts) {
      for (const a of p.annotations || []) {
        if (a.type !== 'url_citation' || !a.url) continue;
        if (!chunkIndex.has(a.url)) {
          chunkIndex.set(a.url, chunks.length);
          chunks.push({ uri: a.url, title: a.title || '' });
        }
        const sentence = sentenceBefore(p.text, a.start_index);
        if (!sentence) continue;
        const entry = supportsByText.get(sentence) || { text: sentence, chunkIndices: [], confidence: null };
        if (!entry.chunkIndices.includes(chunkIndex.get(a.url))) entry.chunkIndices.push(chunkIndex.get(a.url));
        supportsByText.set(sentence, entry);
      }
      offset += p.text.length;
    }
    grounding = { queries, suggestionsHtml: '', chunks, supports: [...supportsByText.values()] };
  }

  const u = data?.usage || {};
  return {
    text,
    json: json ? parseJsonText(NAME, text) : undefined,
    grounding,
    finishReason: incomplete === 'max_output_tokens' ? 'MAX_TOKENS' : 'STOP',
    usage: { promptTokens: u.input_tokens || 0, outputTokens: u.output_tokens || 0 },
  };
}

export async function testConnection({ apiKey, model }) {
  const models = await listModels({ apiKey });
  if (!model) return { ok: true, message: `Key works. ${models.length} OpenAI models available; choose one.`, models };
  if (!models.some((m) => m.id === model)) return { ok: false, message: `Key works, but the model "${model}" is not available to this key.`, models };
  await withRetry(() => generate({ apiKey, model, prompt: 'Reply with the single word OK.', maxOutputTokens: 256, timeoutMs: 30000 }), { retries: 2, baseMs: 3000, maxMs: 10000 });
  return { ok: true, message: `Connected. "${model}" answered a test prompt.`, models };
}
