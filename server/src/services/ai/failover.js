import { getAdapter } from '../../integrations/ai/index.js';
import { AiError, withRetry } from '../../integrations/ai/errors.js';
import { runWithFailover } from './routing.js';

// One model call that starts with the best ready provider and switches on any
// AiError (limits, credit, keys, outages). Used outside the article pipeline,
// for example by Autopilot. Returns { result, provider, switches }.
export async function callWithFailover(chain, opts, schema, role = 'writer') {
  const switches = [];
  if (!chain.length) throw new AiError('No AI provider is ready.', { code: 'no_key' });
  const { result, provider } = await runWithFailover(
    chain,
    role,
    (p, { hasNext }) =>
      withRetry(
        async () => {
          const r = await getAdapter(p.key).generate({ apiKey: p.apiKey, baseUrl: p.baseUrl, model: p.model, ...opts, maxOutputTokens: Math.min(opts.maxOutputTokens || 4096, p.doc?.modelOutputLimit || 8192) });
          if (schema) {
            const parsed = schema.safeParse(r.json);
            if (!parsed.success) throw new AiError(`${p.info.name}'s answer did not have the expected structure.`, { retryable: true, code: 'bad_shape' });
            r.json = parsed.data;
          }
          return r;
        },
        { retries: hasNext ? 1 : 3, canRetry: (err) => !(hasNext && err.code === 'rate_limit') },
      ),
    { onSwitch: (p, _next, err) => switches.push(`${p.info.name}: ${err.message.slice(0, 200)}`) },
  );
  return { result, provider, switches };
}
