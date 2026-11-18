import { AiError, withRetry } from './errors.js';
import { parseJsonText, requestJson } from './http.js';

// Ollama adapter: free models running on this computer (https://ollama.com).
// No API key and no web search, so it can write but not research.
const NAME = 'Ollama';

const base = (baseUrl) => String(baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');

export async function listModels({ baseUrl }) {
  const data = await requestJson(NAME, `${base(baseUrl)}/api/tags`, { timeoutMs: 10000 }).catch((err) => {
    if (err instanceof AiError && err.code === 'network') {
      throw new AiError(`Ollama is not running at ${base(baseUrl)}. Install it from https://ollama.com, start it, and pull a model (for example "ollama pull llama3.1").`, { code: 'not_running', retryable: false });
    }
    throw err;
  });
  return (data?.models || []).filter((m) => !/embed/i.test(m.name)).map((m) => ({ id: m.name, name: m.name })).sort((a, b) => a.id.localeCompare(b.id));
}

export async function generate({ baseUrl, model, system, prompt, json = false, webSearch = false, googleSearch = false, temperature = 0.5, maxOutputTokens = 8192, timeoutMs = 600000 }) {
  if (webSearch || googleSearch) throw new AiError('Ollama has no web search. Choose Gemini, OpenAI or Anthropic for research.', { code: 'unsupported' });
  if (!model) throw new AiError('No Ollama model is selected. Choose one in AI Providers.', { code: 'no_model' });
  const messages = [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }];
  // Local models can be slow on modest hardware, so allow up to 10 minutes.
  const data = await requestJson(NAME, `${base(baseUrl)}/api/chat`, {
    method: 'POST',
    body: { model, messages, stream: false, ...(json ? { format: 'json' } : {}), options: { temperature, num_predict: maxOutputTokens } },
    timeoutMs: Math.max(timeoutMs, 600000),
  });
  const text = data?.message?.content || '';
  if (!text) throw new AiError('Ollama returned no text.', { retryable: true, code: 'empty' });
  if (json && data?.done_reason === 'length') throw new AiError('Ollama stopped before finishing its answer (output limit reached).', { retryable: true, code: 'max_tokens' });
  return {
    text,
    json: json ? parseJsonText(NAME, text) : undefined,
    grounding: null,
    finishReason: data?.done_reason === 'length' ? 'MAX_TOKENS' : 'STOP',
    usage: { promptTokens: data?.prompt_eval_count || 0, outputTokens: data?.eval_count || 0 },
  };
}

export async function testConnection({ baseUrl, model }) {
  const models = await listModels({ baseUrl });
  if (!models.length) return { ok: false, message: 'Ollama is running but has no models. Pull one, for example "ollama pull llama3.1".', models };
  if (!model) return { ok: true, message: `Ollama is running with ${models.length} model(s); choose one.`, models };
  if (!models.some((m) => m.id === model)) return { ok: false, message: `Ollama does not have the model "${model}".`, models };
  await withRetry(() => generate({ baseUrl, model, prompt: 'Reply with the single word OK.', maxOutputTokens: 64 }), { retries: 1, baseMs: 2000 });
  return { ok: true, message: `Connected. "${model}" answered a test prompt.`, models };
}
