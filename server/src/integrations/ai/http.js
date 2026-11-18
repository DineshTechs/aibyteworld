import { AiError } from './errors.js';

const NO_CREDIT = /no credits|credit balance|insufficient[_ ]quota|insufficient (funds|credit|balance)|exceeded your current quota|billing|out of credits|payment required/i;

// Shared HTTP helper for AI adapters: timeouts, JSON parsing, and mapping of
// HTTP failures to AiError (retryable or not). `name` prefixes messages.
export async function requestJson(name, url, { method = 'GET', headers = {}, body, timeoutMs = 120000, mapError } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    const timedOut = err?.name === 'AbortError';
    throw new AiError(timedOut ? `${name} did not respond within ${Math.round(timeoutMs / 1000)} seconds` : `Could not reach ${name}: ${err.message}`, {
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
    const msg = (typeof data?.error === 'string' ? data.error : data?.error?.message) || data?.message || `HTTP ${res.status}`;
    const custom = mapError?.(res, data, msg);
    if (custom) throw custom;
    const retryAfter = Number(res.headers.get('retry-after')) * 1000 || 0;
    if (res.status === 401 || res.status === 403) throw new AiError(`${name} refused the request (check the API key): ${msg}`, { status: res.status, code: 'auth' });
    if (res.status === 404) throw new AiError(`${name} model or endpoint not found: ${msg}`, { status: 404, code: 'not_found' });
    if (res.status === 402) throw new AiError(`${name} account has no credit: ${msg}`, { status: 402, code: 'quota' });
    // Out of credit or a used-up quota looks like a rate limit (429) but waiting will not fix it.
    if ((res.status === 429 || res.status === 403 || res.status === 400) && NO_CREDIT.test(msg)) {
      throw new AiError(`${name} has no credit or quota left: ${msg}`, { status: res.status, code: 'quota' });
    }
    if (res.status === 429) throw new AiError(`${name} rate limit reached: ${msg}`, { status: 429, retryable: true, retryAfterMs: retryAfter, code: 'rate_limit' });
    if (res.status === 408 || res.status >= 500) throw new AiError(`${name} server error (${res.status}): ${msg}`, { status: res.status, retryable: true, retryAfterMs: retryAfter, code: 'server' });
    throw new AiError(`${name} request failed: ${msg}`, { status: res.status, code: 'bad_request' });
  }
  return data;
}

// Strips ``` fences and parses JSON, falling back to the outermost {...}.
export function parseJsonText(name, text) {
  const t = String(text || '')
    .trim()
    .replace(/^```[a-zA-Z]*\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim();
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(t.slice(a, b + 1));
      } catch {
        /* fall through */
      }
    }
    throw new AiError(`${name} returned malformed JSON.`, { retryable: true, code: 'bad_json' });
  }
}

// Cleans a cited sentence: drops markdown links/citation markers and extra space.
export function cleanCitedText(s) {
  return String(s || '')
    .replace(/\(\[[^\]]*\]\([^)]*\)\)/g, '')
    .replace(/\[([^\]]*)\]\((https?:[^)]*)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
