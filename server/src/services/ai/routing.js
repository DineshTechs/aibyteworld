import { AiError } from '../../integrations/ai/errors.js';
import { markFailure, markSuccess, orderForNow } from './health.js';

/**
 * Tries the providers of a chain in order until one succeeds.
 * Every call starts again from the best provider that is not cooling down,
 * so a fallback is only used while the better provider is unavailable.
 *
 * attempt(p, { hasNext }) does the work for one provider and throws AiError
 * on failure. hooks.onSwitch(from, to, err) and hooks.onSkip(cooling) let the
 * caller record what happened.
 */
export async function runWithFailover(chain, role, attempt, hooks = {}) {
  const { order, cooling } = await orderForNow(chain, role);
  if (cooling.length && order.length > cooling.length) await hooks.onSkip?.(cooling);
  let lastErr;
  for (let i = 0; i < order.length; i += 1) {
    const p = order[i];
    const next = order[i + 1];
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await attempt(p, { hasNext: Boolean(next) });
      // eslint-disable-next-line no-await-in-loop
      await markSuccess(p.key, role);
      return { result, provider: p };
    } catch (err) {
      if (!(err instanceof AiError)) throw err;
      lastErr = err;
      // eslint-disable-next-line no-await-in-loop
      await markFailure(p.key, role, err);
      if (!next) throw err;
      // eslint-disable-next-line no-await-in-loop
      await hooks.onSwitch?.(p, next, err);
    }
  }
  throw lastErr || new AiError('No provider is ready.', { code: 'no_key' });
}
