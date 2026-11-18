import { Article, ResearchJob, ResearchSource, SiteSettings } from '../../models/index.js';
import { logActivity } from '../activityService.js';
import { afterPublish } from '../publishHooks.js';

// Strict checks before Autopilot may publish without a person. Any failure
// leaves the article in "Pending approval" with the reasons recorded.
export async function evaluateGate(job, article, cfg) {
  const reasons = [];
  const q = job.quality || {};
  if (job.status !== 'completed') reasons.push('the job did not finish');
  if (!article) reasons.push('no article was saved');
  if ((q.citedSources || 0) < cfg.minSources) reasons.push(`only ${q.citedSources || 0} sources cited (needs ${cfg.minSources})`);
  if ((q.citedFindings || 0) < cfg.minCitedFindings) reasons.push(`only ${q.citedFindings || 0} research facts cited (needs ${cfg.minCitedFindings})`);
  if ((q.uncitedFigureParagraphs || 0) > 0) reasons.push(`${q.uncitedFigureParagraphs} paragraph(s) have figures without a citation`);
  if ((q.words || 0) < job.input.length * 0.7) reasons.push(`${q.words || 0} words, below 70% of the ${job.input.length} target`);
  const cited = job.findings.filter((f) => f.used);
  if (cited.some((f) => f.conflict)) reasons.push('it cites facts that sources disagree on');
  if (cited.some((f) => f.outdated)) reasons.push('it cites facts that may be out of date');
  // Provider switches and pauses are handled by failover, so they never block publishing.
  const blocking = job.warnings.filter((w) => !/^(Switched|Skipped) /.test(w) && /referred to findings that do not exist|does not cite any research|well short of|output limit|AI-style phrases remain/.test(w));
  blocking.forEach((w) => reasons.push(w.replace(/\.$/, '').toLowerCase()));
  if (article) {
    const unreachable = await ResearchSource.countDocuments({ _id: { $in: article.sources }, reachable: false });
    if (unreachable) reasons.push(`${unreachable} cited source page(s) could not be reached`);
    if (!article.seo?.title || !article.seo?.description) reasons.push('SEO title or description is missing');
    if (cfg.requireImage !== false && !article.featuredImage?.url) reasons.push('there is no cover image (set up an image source in AI Providers)');
  }
  return { passed: reasons.length === 0, reasons };
}

// Runs after an Autopilot job finishes: publish when allowed and the checks pass.
export async function applyAutopilotGate(jobId) {
  const job = await ResearchJob.findById(jobId);
  if (!job?.autopilot?.enabled) return null;
  const cfg = (await SiteSettings.getSingleton()).autopilot;
  const article = job.article ? await Article.findById(job.article) : null;
  const gate = await evaluateGate(job, article, cfg);
  const allowed = cfg.publishMode === 'auto_if_checks_pass';
  if (!allowed) gate.reasons.unshift('publishing mode is "always wait for approval"');
  job.autopilot.gate = { passed: gate.passed, reasons: gate.reasons, checkedAt: new Date() };
  let published = false;
  if (gate.passed && allowed && article && article.status === 'pending_approval') {
    // Claim the publish atomically so it can never happen twice.
    const now = new Date();
    const res = await Article.updateOne(
      { _id: article._id, status: 'pending_approval' },
      {
        $set: { status: 'published', publishedAt: now },
        $push: { history: { action: 'status:pending_approval->published', at: now, note: 'Auto-published by Autopilot: all quality checks passed' } },
      },
    );
    published = res.modifiedCount === 1;
    if (published) await afterPublish(article._id);
  }
  // Already published by an earlier run of the gate: keep that state.
  if (!published && job.autopilot.published && article?.status === 'published') published = true;
  job.autopilot.published = published;
  await job.save();
  const actor = { user: { _id: job.createdBy, name: 'Autopilot' } };
  if (published) {
    await logActivity(actor, 'autopilot.published', { entityType: 'Article', entityId: article._id, summary: `Autopilot published "${article.title}"` });
  } else if (article) {
    await logActivity(actor, 'autopilot.held', { entityType: 'Article', entityId: article._id, summary: `Autopilot held "${article.title}" for approval: ${gate.reasons.join('; ')}`.slice(0, 500) });
  }
  return { ...gate, published };
}
