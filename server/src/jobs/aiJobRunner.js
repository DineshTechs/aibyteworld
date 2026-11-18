import { logger } from '../config/logger.js';
import { Article, ResearchJob } from '../models/index.js';
import { logActivity } from '../services/activityService.js';
import { JobCancelled, runPipeline } from '../services/ai/pipeline.js';
import { applyAutopilotGate } from '../services/autopilot/gate.js';
import { notifyAutopilotPublished, notifyFailed, notifyHeld, notifyRefreshReady, notifyReview } from '../services/telegram/bot.js';

const STALE_MS = 15 * 60 * 1000;
let busy = false;

// Claims the oldest queued job atomically, so two processes never run the same job.
export async function claimNextJob() {
  return ResearchJob.findOneAndUpdate(
    { status: 'queued' },
    { $set: { status: 'running', lockedAt: new Date(), error: '' } },
    { sort: { createdAt: 1 }, new: true },
  );
}

export async function runJob(job) {
  try {
    await runPipeline(job._id);
    let gate = null;
    if (job.autopilot?.enabled) {
      try {
        gate = await applyAutopilotGate(job._id);
      } catch (err) {
        logger.error({ job: String(job._id), err: err.message }, 'Autopilot quality gate failed; the article stays pending approval');
      }
    }
    // Telegram: tell the admins what happened (never throws).
    const done = await ResearchJob.findById(job._id).select('article').lean();
    const article = done?.article ? await Article.findById(done.article) : null;
    if (article && job.input?.refreshOf) {
      if (article.refresh) await notifyRefreshReady(article);
    } else if (article && job.autopilot?.enabled) {
      if (gate?.published) await notifyAutopilotPublished(article);
      else if (article.status === 'pending_approval') await notifyHeld(article, gate?.reasons?.length ? gate.reasons : ['the quality checks could not run']);
    } else if (article?.status === 'pending_approval') {
      await notifyReview(article);
    }
  } catch (err) {
    const cancelled = err instanceof JobCancelled;
    await ResearchJob.updateOne(
      { _id: job._id },
      { $set: { status: cancelled ? 'cancelled' : 'failed', error: cancelled ? '' : err.message, finishedAt: new Date() }, $unset: { lockedAt: 1 } },
    );
    if (!cancelled) {
      logger.error({ job: String(job._id), err: err.message }, 'AI job failed');
      await logActivity({ user: { _id: job.createdBy, name: 'AI Content Studio' } }, 'ai.job_failed', { entityType: 'ResearchJob', entityId: job._id, summary: `AI job failed: ${err.message}`.slice(0, 300) });
      await notifyFailed(`${job.autopilot?.enabled ? 'Autopilot' : 'AI'} article failed: "${job.input?.topic || ''}"\n${err.message}`);
    }
  }
}

export async function processQueueOnce() {
  if (busy) return false;
  busy = true;
  try {
    const job = await claimNextJob();
    if (!job) return false;
    await runJob(job);
    return true;
  } finally {
    busy = false;
  }
}

// Jobs left "running" by a crash or restart go back in the queue and resume
// from their first unfinished step.
export async function requeueStaleJobs() {
  const res = await ResearchJob.updateMany(
    { status: 'running', $or: [{ lockedAt: { $lt: new Date(Date.now() - STALE_MS) } }, { lockedAt: { $exists: false } }] },
    { $set: { status: 'queued' } },
  );
  return res.modifiedCount;
}

export function startAiJobRunner(intervalMs = 3000) {
  // On startup this process cannot be running any job yet, so every "running" job is stale.
  ResearchJob.updateMany({ status: 'running' }, { $set: { status: 'queued' } })
    .then((r) => r.modifiedCount && logger.info({ jobs: r.modifiedCount }, 'Resuming interrupted AI jobs'))
    .catch((err) => logger.error({ err }, 'Could not requeue AI jobs'));
  const timer = setInterval(() => {
    processQueueOnce().catch((err) => logger.error({ err }, 'AI job runner tick failed'));
  }, intervalMs);
  const staleTimer = setInterval(() => requeueStaleJobs().catch(() => {}), 60000);
  timer.unref();
  staleTimer.unref();
  return () => {
    clearInterval(timer);
    clearInterval(staleTimer);
  };
}
