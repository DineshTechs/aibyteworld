import { AiError, withRetry } from './errors.js';
import { cleanCitedText, parseJsonText, requestJson } from './http.js';

// Anthropic adapter (Messages API). Research uses Claude's server-side web
// search tool; cited text blocks carry web_search_result_location citations.
// Docs: https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
const BASE = 'https://api.anthropic.com/v1';
const NAME = 'Anthropic';
const VERSION = '2023-06-01';

const mapError = (res, data, msg) => {
  const type = data?.error?.type || '';
  if (res.status === 529 || type === 'overloaded_error') return new AiError(`Anthropic is overloaded: ${msg}`, { status: res.status, retryable: true, code: 'server' });
  if (res.status === 400 && /credit balance/i.test(msg)) return new AiError(`Anthropic account has no credit: ${msg}`, { status: 400, code: 'quota' });
  if (res.status === 400 && /web search is not enabled/i.test(msg)) {
    return new AiError('Web search is disabled for this Anthropic organization. An admin can enable it in the Claude Console under Settings > Capabilities.', { status: 400, code: 'auth' });
  }
  return null;
};

const call = (path, { apiKey, ...opts }) => {
  if (!apiKey) throw new AiError('No Anthropic API key is configured. Add one in AI Providers.', { code: 'no_key' });
  return requestJson(NAME, `${BASE}${path}`, { ...opts, headers: { 'x-api-key': apiKey, 'anthropic-version': VERSION }, mapError });
};

export async function listModels({ apiKey }) {
  const out = [];
  let after = '';
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const data = await call(`/models?limit=100${after ? `&after_id=${encodeURIComponent(after)}` : ''}`, { apiKey, timeoutMs: 20000 });
    for (const m of data?.data || []) out.push({ id: m.id, name: m.display_name || m.id, outputTokenLimit: m.max_tokens || undefined });
    if (!data?.has_more) break;
    after = data.last_id;
  }
  return out;
}

export async function generate({ apiKey, model, system, prompt, json = false, webSearch = false, googleSearch = false, maxOutputTokens = 8192, timeoutMs = 180000, maxSearches = 5 }) {
  if (!model) throw new AiError('No Anthropic model is selected. Choose one in AI Providers.', { code: 'no_model' });
  const search = webSearch || googleSearch;
  const body = {
    model,
    max_tokens: maxOutputTokens,
    messages: [{ role: 'user', content: prompt }],
    ...(system ? { system: json ? `${system}\nReply with a single JSON object and nothing else.` : system } : {}),
    ...(search ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxSearches }] } : {}),
  };
  let data = await call('/messages', { apiKey, method: 'POST', body, timeoutMs });
  // A long search turn can pause; send it back unchanged to let it finish.
  for (let i = 0; i < 3 && data?.stop_reason === 'pause_turn'; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    data = await call('/messages', { apiKey, method: 'POST', body: { ...body, messages: [...body.messages, { role: 'assistant', content: data.content }] }, timeoutMs });
  }

  const blocks = data?.content || [];
  const textBlocks = blocks.filter((b) => b.type === 'text');
  const text = textBlocks.map((b) => b.text).join('');
  if (!text) throw new AiError(`Anthropic returned no text (${data?.stop_reason || 'no content'}).`, { retryable: data?.stop_reason !== 'refusal', code: 'empty' });
  if (json && data?.stop_reason === 'max_tokens') throw new AiError('Anthropic stopped before finishing its answer (output limit reached).', { retryable: true, code: 'max_tokens' });

  let grounding = null;
  if (search) {
    const queries = blocks.filter((b) => b.type === 'server_tool_use' && b.name === 'web_search').map((b) => b.input?.query).filter(Boolean);
    const errors = blocks.filter((b) => b.type === 'web_search_tool_result' && b.content && !Array.isArray(b.content)).map((b) => b.content.error_code);
    if (errors.includes('too_many_requests')) throw new AiError('Anthropic web search rate limit reached.', { status: 429, retryable: true, code: 'rate_limit' });
    const chunks = [];
    const chunkIndex = new Map();
    const supports = [];
    for (const b of textBlocks) {
      const cites = (b.citations || []).filter((c) => c.type === 'web_search_result_location' && c.url);
      if (!cites.length) continue;
      const idx = [];
      for (const c of cites) {
        if (!chunkIndex.has(c.url)) {
          chunkIndex.set(c.url, chunks.length);
          chunks.push({ uri: c.url, title: c.title || '' });
        }
        if (!idx.includes(chunkIndex.get(c.url))) idx.push(chunkIndex.get(c.url));
      }
      supports.push({ text: cleanCitedText(b.text), chunkIndices: idx, confidence: null });
    }
    grounding = { queries, suggestionsHtml: '', chunks, supports };
  }

  const u = data?.usage || {};
  return {
    text,
    json: json ? parseJsonText(NAME, text) : undefined,
    grounding,
    finishReason: data?.stop_reason === 'max_tokens' ? 'MAX_TOKENS' : 'STOP',
    usage: { promptTokens: u.input_tokens || 0, outputTokens: u.output_tokens || 0 },
  };
}

export async function testConnection({ apiKey, model }) {
  const models = await listModels({ apiKey });
  if (!model) return { ok: true, message: `Key works. ${models.length} Claude models available; choose one.`, models };
  if (!models.some((m) => m.id === model)) return { ok: false, message: `Key works, but the model "${model}" is not available to this key.`, models };
  await withRetry(() => generate({ apiKey, model, prompt: 'Reply with the single word OK.', maxOutputTokens: 256, timeoutMs: 30000 }), { retries: 2, baseMs: 3000, maxMs: 10000 });
  return { ok: true, message: `Connected. "${model}" answered a test prompt.`, models };
}
