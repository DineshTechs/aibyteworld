import { logger } from '../../config/logger.js';
import { ResearchJob, SiteSettings, User } from '../../models/index.js';
import { logActivity } from '../activityService.js';
import { providerChain } from '../ai/providerService.js';
import { localDayStart, nextRunTime, slotKind } from './schedule.js';
import { notifyFailed } from '../telegram/bot.js';
import { discoverTrends, evergreenHints, pickEvergreen, pickTopic, recentTitles, similarity } from './topics.js';

// The kind of the next scheduled post: today's posts so far decide its place in the day.
export async function nextKind(cfg, now = new Date()) {
  const done = await ResearchJob.countDocuments({ 'autopilot.enabled': true, createdAt: { $gte: localDayStart(now, cfg.timezone) } });
  return slotKind(done, cfg.postsPerDay, cfg.evergreenPerDay);
}

// Starts one Autopilot post: finds trends, picks a new topic and queues an
// article job (the normal job runner does the research and writing).
export async function startAutopilotPost(reason = 'schedule', kind = 'trending') {
  const settings = await SiteSettings.getSingleton();
  const cfg = settings.autopilot;
  const research = await providerChain(settings.ai, 'research');
  const writer = await providerChain(settings.ai, 'writer');
  if (!research.chain.length || !writer.chain.length) throw new Error('No research or writing provider is ready. Check AI Providers.');

  const since = new Date();
  since.setHours(0, 0, 0, 0);
  if ((await ResearchJob.countDocuments({ createdAt: { $gte: since } })) >= settings.ai.dailyJobLimit) {
    throw new Error(`The daily limit of ${settings.ai.dailyJobLimit} AI articles is reached. Raise it in AI Providers.`);
  }

  const owner = (cfg.runAs && (await User.findOne({ _id: cfg.runAs, active: true }))) || (await User.findOne({ role: 'admin', active: true }).sort({ createdAt: 1 }));
  if (!owner) throw new Error('No active administrator to publish as.');

  const covered = await recentTitles();
  let pick;
  let via;
  let found = 0;
  let given = '';
  if (kind === 'evergreen') {
    // The admin's own ideas first (skipping any that are already covered).
    given = (cfg.evergreenTopics || []).find((t) => !covered.some((c) => similarity(c, t) >= 0.6)) || '';
    const hints = given ? [] : await evergreenHints(cfg, research.chain);
    pick = await pickEvergreen(cfg, writer.chain, covered, hints, given);
    via = given ? 'your evergreen topic list' : `${hints.length ? 'Tavily hints and ' : ''}the writing model`;
  } else {
    const { trends, via: v } = await discoverTrends(cfg, research.chain);
    pick = await pickTopic(cfg, trends, writer.chain, covered);
    via = v;
    found = trends.length;
  }
  const instructions = kind === 'evergreen'
    ? `This is an evergreen guide that should stay useful for a year or more. ${pick.angle} Answer the reader's question step by step with practical advice, use only the research findings for facts and figures, and avoid news framing and dates unless they come from the findings.`
    : `This article is based on a trending story: "${pick.trend}". ${pick.angle} Explain what happened using only the research findings, then focus on what it means in practice for readers.`;
  const job = await ResearchJob.create({
    input: {
      topic: pick.topic,
      primaryKeyword: pick.primaryKeyword,
      secondaryKeywords: pick.secondaryKeywords,
      country: cfg.country,
      language: cfg.language || 'English',
      audience: pick.audience,
      length: cfg.length,
      style: cfg.style,
      category: cfg.category || undefined,
      instructions: instructions.slice(0, 3000),
    },
    provider: writer.chain[0].key,
    model: writer.chain[0].model,
    createdBy: owner._id,
    autopilot: { enabled: true, kind, trend: pick.trend },
  });
  if (given) await SiteSettings.updateOne({ key: 'site' }, { $pull: { 'autopilot.evergreenTopics': given } });
  await logActivity({ user: { _id: owner._id, name: 'Autopilot' } }, 'autopilot.started', {
    entityType: 'ResearchJob',
    entityId: job._id,
    summary: kind === 'evergreen' ? `Autopilot (${reason}) planned the evergreen guide "${pick.topic}" from ${via}` : `Autopilot (${reason}) picked "${pick.topic}" from ${found} trending stories via ${via}`,
  });
  return job;
}

// Called every minute. Claims the due slot atomically so a post is never
// started twice, then moves the schedule to the next slot.
export async function autopilotTick(now = new Date()) {
  const settings = await SiteSettings.getSingleton();
  const cfg = settings.autopilot;
  if (!cfg.enabled) return null;
  if (!cfg.nextRunAt) {
    await SiteSettings.updateOne({ key: 'site' }, { $set: { 'autopilot.nextRunAt': nextRunTime(now, cfg) } });
    return null;
  }
  const claimed = await SiteSettings.findOneAndUpdate(
    { key: 'site', 'autopilot.enabled': true, 'autopilot.nextRunAt': { $lte: now } },
    { $set: { 'autopilot.nextRunAt': nextRunTime(now, cfg), 'autopilot.lastRunAt': now } },
    { new: true },
  );
  if (!claimed) return null;
  try {
    const job = await startAutopilotPost('schedule', await nextKind(cfg, now));
    await SiteSettings.updateOne({ key: 'site' }, { $set: { 'autopilot.lastResult': `Started ${job.autopilot.kind === 'evergreen' ? 'evergreen guide' : 'trending post'} "${job.input.topic}"` } });
    return job;
  } catch (err) {
    logger.warn({ err: err.message }, 'Autopilot could not start a post');
    await SiteSettings.updateOne({ key: 'site' }, { $set: { 'autopilot.lastResult': `Skipped: ${err.message}`.slice(0, 500) } });
    await logActivity(null, 'autopilot.skipped', { summary: `Autopilot skipped a scheduled post: ${err.message}`.slice(0, 500) });
    await notifyFailed(`Autopilot skipped a scheduled post: ${err.message}`);
    return null;
  }
}

export function startAutopilotScheduler(intervalMs = 60000) {
  const tick = () => autopilotTick().catch((err) => logger.error({ err }, 'Autopilot tick failed'));
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  tick();
  return () => clearInterval(timer);
}
