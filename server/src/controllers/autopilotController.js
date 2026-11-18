import { z } from 'zod';
import { objectId } from '../middleware/validate.js';
import { Category, ResearchJob, SiteSettings, User } from '../models/index.js';
import { logActivity } from '../services/activityService.js';
import { isValidTimeZone, nextRunTime, slotKind, slotMinutes } from '../services/autopilot/schedule.js';
import { nextKind, startAutopilotPost } from '../services/autopilot/runner.js';
import { rotationOrder } from '../services/categories.js';
import { providerChain } from '../services/ai/providerService.js';
import { plainText } from '../utils/content.js';
import { asyncHandler, badRequest, HttpError } from '../utils/http.js';

export const autopilotSchema = z.object({
  enabled: z.boolean(),
  postsPerDay: z.number().int().min(1).max(12),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, for example 06:00'),
  timezone: z.string().refine(isValidTimeZone, 'Unknown time zone'),
  niche: z.string().trim().min(2).max(120),
  keywords: z.array(z.string().trim().min(1).max(60)).max(15).default([]),
  country: z.string().trim().max(80).default(''),
  language: z.string().trim().min(1).max(60).default('English'),
  category: objectId.nullable().optional(),
  rotationCategories: z.array(objectId).max(40).optional(), // empty = every topic category
  length: z.number().int().min(600).max(4000),
  style: z.string().trim().max(120).default(''),
  publishMode: z.enum(['auto_if_checks_pass', 'approval']),
  minSources: z.number().int().min(1).max(20),
  minCitedFindings: z.number().int().min(1).max(40),
  requireImage: z.boolean().default(true),
  evergreenPerDay: z.number().int().min(0).max(12).default(2),
  evergreenTopics: z.array(z.string().trim().min(5).max(200)).max(50).default([]),
  runAs: objectId.nullable().optional(),
});

const fmt = (d, tz) => (d ? new Date(d).toLocaleString('en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }) : '');

async function view() {
  const s = await SiteSettings.getSingleton();
  const cfg = s.autopilot.toObject ? s.autopilot.toObject() : s.autopilot;
  const jobs = await ResearchJob.find({ 'autopilot.enabled': true })
    .sort({ createdAt: -1 })
    .limit(20)
    .select('input.topic status error autopilot article createdAt finishedAt')
    .populate('article', 'title slug status')
    .lean();
  const slots = slotMinutes(cfg.startTime, cfg.postsPerDay).map((m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  const images = await providerChain(s.ai, 'image');
  const imagesReady = Boolean(s.ai.imagesEnabled && images.chain.length);
  const slotKinds = slots.map((_t, i) => slotKind(i, cfg.postsPerDay, cfg.evergreenPerDay));
  const upcoming = cfg.enabled ? await nextKind(cfg) : '';
  // Rotation: which category the next post is for, and the order after it.
  const rotation = (await rotationOrder(cfg)).map((c) => ({ _id: c._id, name: c.name }));
  return { settings: { ...cfg, rotationCategories: (cfg.rotationCategories || []).map(String) }, rotation, slots, slotKinds, nextKind: upcoming, nextRunLocal: cfg.enabled ? fmt(cfg.nextRunAt, cfg.timezone) : '', lastRunLocal: fmt(cfg.lastRunAt, cfg.timezone), jobs, imagesReady, imageSources: images.chain.map((p) => p.info.name) };
}

export const getAutopilot = asyncHandler(async (_req, res) => res.json(await view()));

export const updateAutopilot = asyncHandler(async (req, res) => {
  const b = req.body;
  if (b.category && !(await Category.exists({ _id: b.category }))) throw badRequest('Selected category does not exist');
  if (b.rotationCategories?.length && (await Category.countDocuments({ _id: { $in: b.rotationCategories } })) !== new Set(b.rotationCategories.map(String)).size) throw badRequest('A category in the rotation does not exist');
  if (b.runAs && !(await User.exists({ _id: b.runAs, active: true, role: { $in: ['admin', 'editor'] } }))) throw badRequest('Choose an active admin or editor to publish as');
  const s = await SiteSettings.getSingleton();
  const prev = s.autopilot;
  const scheduleChanged = !prev.enabled || prev.postsPerDay !== b.postsPerDay || prev.startTime !== b.startTime || prev.timezone !== b.timezone;
  Object.assign(s.autopilot, {
    ...b,
    niche: plainText(b.niche),
    keywords: b.keywords.map(plainText).filter(Boolean),
    country: plainText(b.country),
    language: plainText(b.language),
    style: plainText(b.style),
    evergreenPerDay: Math.min(b.evergreenPerDay, b.postsPerDay),
    evergreenTopics: [...new Set(b.evergreenTopics.map(plainText).filter(Boolean))],
    category: b.category || undefined,
    // Older admin pages do not send the rotation list; keep it then.
    rotationCategories: b.rotationCategories ? [...new Set(b.rotationCategories.map(String))] : prev.rotationCategories || [],
    runAs: b.runAs || undefined,
  });
  if (!b.enabled) s.autopilot.nextRunAt = undefined;
  else if (scheduleChanged || !s.autopilot.nextRunAt) s.autopilot.nextRunAt = nextRunTime(new Date(), s.autopilot);
  s.markModified('autopilot');
  await s.save();
  await logActivity(req, 'autopilot.settings', {
    entityType: 'SiteSettings',
    summary: `Autopilot ${b.enabled ? `on: ${b.postsPerDay} posts a day from ${b.startTime} (${b.timezone}), ${b.publishMode === 'approval' ? 'always for approval' : 'auto-publish when checks pass'}` : 'turned off'}`,
  });
  res.json(await view());
});

// Starts one post now (outside the schedule), for testing the setup.
export const runAutopilotNow = asyncHandler(async (req, res) => {
  try {
    const kind = req.body?.kind === 'evergreen' ? 'evergreen' : 'trending';
    const job = await startAutopilotPost('run now', kind);
    await SiteSettings.updateOne({ key: 'site' }, { $set: { 'autopilot.lastRunAt': new Date(), 'autopilot.lastResult': `Started ${kind === 'evergreen' ? 'evergreen guide' : 'trending post'} "${job.input.topic}" (run now)` } });
    await logActivity(req, 'autopilot.run_now', { entityType: 'ResearchJob', entityId: job._id, summary: `Ran Autopilot now: "${job.input.topic}"` });
    res.status(201).json({ job: { _id: job._id, topic: job.input.topic, kind } });
  } catch (err) {
    throw new HttpError(err.code === 'duplicate' ? 409 : 422, err.message);
  }
});
