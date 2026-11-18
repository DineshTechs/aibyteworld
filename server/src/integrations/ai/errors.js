// Error raised by AI provider adapters. `retryable` tells the pipeline whether
// waiting and trying again can help (rate limits, timeouts, 5xx).
export class AiError extends Error {
  constructor(message, { status = 0, retryable = false, retryAfterMs = 0, code = '' } = {}) {
    super(message);
    this.name = 'AiError';
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
    this.code = code;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Calls fn, retrying retryable AiErrors with exponential backoff (or the
// provider's Retry-After). `onRetry` lets the caller record attempts.
export async function withRetry(fn, { retries = 3, baseMs = 2000, maxMs = 60000, onRetry, shouldStop, canRetry = () => true } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await fn(attempt);
    } catch (err) {
      const retryable = err instanceof AiError && err.retryable && canRetry(err);
      if (!retryable || attempt >= retries || shouldStop?.()) throw err;
      const wait = Math.min(maxMs, err.retryAfterMs || baseMs * 2 ** attempt);
      onRetry?.(err, attempt + 1, wait);
      // eslint-disable-next-line no-await-in-loop
      await sleep(wait);
    }
  }
}
