// Small JSON client for third-party APIs (email, social networks, IndexNow).
// Errors carry the HTTP status and the service's own message, never the key.
export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

function messageFrom(data, text) {
  if (!data) return text.slice(0, 200);
  const m = data.message || data.error?.message || data.error_description || data.detail || data.title || data.errors?.[0]?.message || data.error;
  return typeof m === 'string' ? m : JSON.stringify(m || data).slice(0, 200);
}

export async function apiFetch(service, url, { method = 'GET', headers = {}, body, form, timeoutMs = 20000 } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : form ? new URLSearchParams(form).toString() : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new ApiError(`Could not reach ${service}: ${err.name === 'TimeoutError' ? 'timed out' : err.message}`);
  }
  const text = await res.text().catch(() => '');
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const hint = res.status === 401 || res.status === 403 ? ' Check the key or token and its permissions.' : res.status === 429 ? ' Too many requests; it will be tried again later.' : '';
    throw new ApiError(`${service}: ${messageFrom(data, text) || `HTTP ${res.status}`} (HTTP ${res.status}).${hint}`, res.status);
  }
  return { status: res.status, data, headers: res.headers };
}
