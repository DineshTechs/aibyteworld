import { AiError, withRetry } from './errors.js';
import { parseJsonText, requestJson } from './http.js';

// Builds an adapter for any provider with an OpenAI-compatible
// chat-completions API (Nous, Groq, Cerebras, Mistral, OpenRouter).
// These are used for writing; they have no web search here.
export function makeChatAdapter({ name, baseUrl, filterModel = () => true, mapModel = (m) => ({ id: m.id, name: m.name || m.id }), extraHeaders = {} }) {
  const call = (path, { apiKey, ...opts }) => {
    if (!apiKey) throw new AiError(`No ${name} API key is configured. Add one in AI Providers.`, { code: 'no_key' });
    return requestJson(name, `${baseUrl}${path}`, {
      ...opts,
      headers: { Authorization: `Bearer ${apiKey}`, ...extraHeaders },
      mapError: (res, data, msg) => {
        if (res.status === 413) return new AiError(`${name} says the request is too large for this plan: ${msg}`, { status: 413, code: 'too_large' });
        if (res.status === 429 && /quota|credits|daily|per day|limit exceeded for/i.test(msg)) {
          return new AiError(`${name} free-tier limit reached: ${msg}`, { status: 429, code: 'quota' });
        }
        return null;
      },
    });
  };

  async function listModels({ apiKey }) {
    const data = await call('/models', { apiKey, timeoutMs: 20000 });
    return (data?.data || []).filter(filterModel).map(mapModel).sort((a, b) => a.id.localeCompare(b.id));
  }

  async function generate({ apiKey, model, system, prompt, json = false, webSearch = false, googleSearch = false, temperature = 0.5, maxOutputTokens = 8192, timeoutMs = 180000 }) {
    if (webSearch || googleSearch) throw new AiError(`${name} has no web search here. Use Gemini, OpenAI, Anthropic or Tavily for research.`, { code: 'unsupported' });
    if (!model) throw new AiError(`No ${name} model is selected. Choose one in AI Providers.`, { code: 'no_model' });
    const messages = [
      ...(system ? [{ role: 'system', content: json ? `${system}\nReply with a single JSON object and nothing else.` : system }] : []),
      { role: 'user', content: prompt },
    ];
    const data = await call('/chat/completions', { apiKey, method: 'POST', body: { model, messages, temperature, max_tokens: maxOutputTokens }, timeoutMs });
    const choice = data?.choices?.[0];
    const text = typeof choice?.message?.content === 'string' ? choice.message.content : '';
    if (!text) throw new AiError(`${name} returned no text (${choice?.finish_reason || 'no content'}).`, { retryable: true, code: 'empty' });
    if (json && choice?.finish_reason === 'length') throw new AiError(`${name} stopped before finishing its answer (output limit reached).`, { retryable: true, code: 'max_tokens' });
    const u = data?.usage || {};
    return {
      text,
      json: json ? parseJsonText(name, text) : undefined,
      grounding: null,
      finishReason: choice?.finish_reason === 'length' ? 'MAX_TOKENS' : 'STOP',
      usage: { promptTokens: u.prompt_tokens || 0, outputTokens: u.completion_tokens || 0 },
    };
  }

  async function testConnection({ apiKey, model }) {
    const models = await listModels({ apiKey });
    if (!model) return { ok: true, message: `Key works. ${models.length} ${name} models available; choose one.`, models };
    if (!models.some((m) => m.id === model)) return { ok: false, message: `Key works, but the model "${model}" is not available to this key.`, models };
    await withRetry(() => generate({ apiKey, model, prompt: 'Reply with the single word OK.', maxOutputTokens: 256, timeoutMs: 30000 }), { retries: 2, baseMs: 3000, maxMs: 10000 });
    return { ok: true, message: `Connected. "${model}" answered a test prompt.`, models };
  }

  return { listModels, generate, testConnection };
}

const NOT_TEXT = /embed|whisper|tts|speech|audio|image|vision-only|guard|moderation|ocr|transcri|rerank/i;

export const nous = makeChatAdapter({
  name: 'Nous',
  baseUrl: 'https://inference-api.nousresearch.com/v1',
  filterModel: (m) => !Array.isArray(m.architecture?.output_modalities) || m.architecture.output_modalities.includes('text'),
  mapModel: (m) => ({ id: m.id, name: m.name || m.id, outputTokenLimit: m.top_provider?.max_completion_tokens || undefined }),
});

// https://console.groq.com/docs (free plan, rate limited)
export const groq = makeChatAdapter({
  name: 'Groq',
  baseUrl: 'https://api.groq.com/openai/v1',
  filterModel: (m) => m.active !== false && !NOT_TEXT.test(m.id),
  mapModel: (m) => ({ id: m.id, name: m.id, outputTokenLimit: m.max_completion_tokens || undefined }),
});

// https://inference-docs.cerebras.ai (free tier, rate limited)
export const cerebras = makeChatAdapter({ name: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1', filterModel: (m) => !NOT_TEXT.test(m.id) });

// https://docs.mistral.ai (free Experiment plan; requests may be used for training)
export const mistral = makeChatAdapter({
  name: 'Mistral',
  baseUrl: 'https://api.mistral.ai/v1',
  filterModel: (m) => (m.capabilities ? m.capabilities.completion_chat !== false : true) && !NOT_TEXT.test(m.id) && !m.deprecation,
  mapModel: (m) => ({ id: m.id, name: m.name || m.id }),
});

// https://openrouter.ai/docs (only ":free" models are listed, so nothing is billed)
export const openrouter = makeChatAdapter({
  name: 'OpenRouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  filterModel: (m) => String(m.id).endsWith(':free') && (!Array.isArray(m.architecture?.output_modalities) || m.architecture.output_modalities.includes('text')),
  mapModel: (m) => ({ id: m.id, name: m.name || m.id, outputTokenLimit: m.top_provider?.max_completion_tokens || undefined }),
  extraHeaders: { 'X-Title': 'blogSite' },
});
