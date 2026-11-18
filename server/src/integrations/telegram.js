// Minimal Telegram Bot API client. Docs: https://core.telegram.org/bots/api
export class TelegramError extends Error {
  constructor(message, status = 0, retryAfter = 0) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export async function tg(token, method, body = {}, timeoutMs = 20000) {
  if (!token) throw new TelegramError('No bot token is set.');
  let res;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new TelegramError(`Could not reach Telegram: ${err.name === 'TimeoutError' ? 'timed out' : err.message}`);
  }
  const data = await res.json().catch(() => null);
  if (!data?.ok) {
    const msg = data?.description || `HTTP ${res.status}`;
    throw new TelegramError(res.status === 401 || res.status === 404 ? `Telegram rejected the bot token (${msg}).` : `Telegram: ${msg}`, res.status, data?.parameters?.retry_after || 0);
  }
  return data.result;
}

// Text for parse_mode HTML.
export const tgEscape = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
