import { Category, ResearchJob, SiteSettings } from '../../models/index.js';
import { plainText } from '../../utils/content.js';
import { logActivity } from '../activityService.js';
import { providerChain } from './providerService.js';

// Starting an AI article, shared by AI Content Studio and Telegram.

export class JobStartError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Whether AI articles can be written now (research and writing providers ready). */
export async function aiReadiness() {
  const settings = (await SiteSettings.getSingleton()).ai;
  const research = await providerChain(settings, 'research');
  const writer = await providerChain(settings, 'writer');
  let reason = '';
  if (!research.chain.length) reason = `No research provider is ready (research needs web search: Gemini, OpenAI, Anthropic, or the free Tavily search). ${research.skipped.join('; ')}`.trim();
  else if (!writer.chain.length) reason = `No writing provider is ready. ${writer.skipped.join('; ')}`.trim();
  return { ready: !reason, reason, settings, research, writer };
}

/** "acme.com" from a website address, for a placeholder topic. */
const hostOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/**
 * Queues an AI article. `input` uses the AI Content Studio fields; with
 * siteUrl and no topic, the topic is named after the website once it is read.
 * `req` is used for the activity log (or { user } outside a request).
 */
export async function startAiJob(input, req) {
  const { ready, reason, settings, writer } = await aiReadiness();
  if (!ready) throw new JobStartError(`${reason} Add an API key and model in AI Providers.`);
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  if ((await ResearchJob.countDocuments({ createdAt: { $gte: since } })) >= settings.dailyJobLimit) {
    throw new JobStartError(`The daily limit of ${settings.dailyJobLimit} AI articles has been reached. Change it in AI Providers or try tomorrow.`, 429);
  }
  if (input.category && !(await Category.exists({ _id: input.category }))) throw new JobStartError('Selected category does not exist');

  const siteUrl = String(input.siteUrl || '').trim();
  const topic = plainText(input.topic || '');
  const job = await ResearchJob.create({
    input: {
      topic: topic || `About ${hostOf(siteUrl) || 'the website'}`,
      primaryKeyword: plainText(input.primaryKeyword || ''),
      secondaryKeywords: (input.secondaryKeywords || []).map(plainText).filter(Boolean),
      country: plainText(input.country || ''),
      language: plainText(input.language || '') || 'English',
      audience: plainText(input.audience || ''),
      length: input.length || 1500,
      style: plainText(input.style || ''),
      category: input.category || undefined,
      instructions: plainText(input.instructions || ''),
      siteUrl,
      topicAuto: Boolean(siteUrl && !topic),
      sponsored: Boolean(siteUrl && input.sponsored),
    },
    provider: writer.chain[0].key,
    model: writer.chain[0].model,
    createdBy: req.user._id,
  });
  await logActivity(req, 'ai.job_create', { entityType: 'ResearchJob', entityId: job._id, summary: siteUrl ? `Started AI article about ${siteUrl}` : `Started AI article: ${job.input.topic}` });
  return job;
}
