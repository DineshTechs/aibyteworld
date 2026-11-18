import { AiError } from '../ai/errors.js';
import { requestJson } from '../ai/http.js';

// Tavily web search (free plan: 1,000 credits a month; a basic search is 1 credit).
// Docs: https://docs.tavily.com
const NAME = 'Tavily';

export async function search({ apiKey, query, maxResults = 5, country, topic = 'general', days }) {
  if (!apiKey) throw new AiError('No Tavily API key is configured. Add one in AI Providers.', { code: 'no_key' });
  const data = await requestJson(NAME, 'https://api.tavily.com/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: {
      query: String(query).slice(0, 400),
      search_depth: 'basic',
      max_results: maxResults,
      include_answer: false,
      topic,
      ...(topic === 'news' && days ? { days } : {}),
      ...(country ? { country: country.toLowerCase() } : {}),
    },
    timeoutMs: 30000,
    mapError: (res, d, msg) => {
      // Tavily returns 432/433 when the plan's credits or limits are used up.
      if (res.status === 432 || res.status === 433 || /credit|usage limit|plan/i.test(msg)) {
        return new AiError(`Tavily free credits used up: ${msg}`, { status: res.status, code: 'quota' });
      }
      if (res.status === 400 && /country/i.test(msg) && country) return null;
      return null;
    },
  });
  return (data?.results || [])
    .filter((r) => /^https?:\/\//i.test(r.url || ''))
    .map((r) => ({ url: r.url, title: String(r.title || ''), content: String(r.content || ''), publishedDate: r.published_date || '' }));
}

export async function testConnection({ apiKey }) {
  const results = await search({ apiKey, query: 'Tavily search API', maxResults: 1 });
  return { ok: true, message: `Connected. A test search returned ${results.length} result(s) (uses 1 free credit).`, models: [] };
}
