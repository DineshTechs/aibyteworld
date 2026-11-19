import { z } from 'zod';
import { getAdapter, PROVIDER_INFO, PROVIDER_KEYS_SUPPORTED, qualityLabel, qualityScore } from '../integrations/ai/index.js';
import { AiError } from '../integrations/ai/errors.js';
import { objectId } from '../middleware/validate.js';
import { AIProvider, Category, ResearchJob, ResearchSource, SiteSettings } from '../models/index.js';
import { logActivity } from '../services/activityService.js';
import { clearHealth, healthView } from '../services/ai/health.js';
import { fitsRole, getActiveProvider, providerChain } from '../services/ai/providerService.js';
import { JobStartError, startAiJob } from '../services/ai/jobService.js';
import { env } from '../config/env.js';
import { encryptSecret } from '../utils/crypto.js';
import { plainText } from '../utils/content.js';
import { asyncHandler, badRequest, conflict, HttpError, notFound, paged, parsePaging } from '../utils/http.js';

const SUPPORTED = PROVIDER_KEYS_SUPPORTED;

const aiErrorToHttp = (err) => (err instanceof AiError ? new HttpError(['rate_limit', 'quota'].includes(err.code) ? 429 : 502, err.message) : err);

async function providerView(key) {
  const p = await getActiveProvider(key);
  const doc = p.doc;
  const base = doc ? doc.toSafe() : { key, enabled: true, model: '', baseUrl: '', hasKey: false, apiKeyLast4: '', lastTest: null };
  const { envVar, ...info } = PROVIDER_INFO[key];
  const score = qualityScore(key, p.model);
  return {
    ...base,
    ...info,
    kind: info.kind || 'text',
    key,
    baseUrl: p.baseUrl || '',
    keySource: base.hasKey ? 'dashboard' : p.keySource,
    quality: { score, label: qualityLabel(score) },
    health: await healthView(key),
  };
}

// Clears cooldowns of a provider and of image sources that share its key.
async function clearHealthFor(key) {
  await clearHealth(key);
  for (const [k, info] of Object.entries(PROVIDER_INFO)) if (info.keyFrom === key) await clearHealth(k); // eslint-disable-line no-await-in-loop
}

// The order providers are tried in, as the admin will see it (best first when
// orderMode is "quality"; not-ready providers stay in the list, marked).
async function effectiveOrders(ai) {
  const docs = await AIProvider.find({}, 'key model').lean();
  const model = (k) => docs.find((d) => d.key === k)?.model || '';
  const order = (list, role) => {
    const keys = (list || []).filter((k) => fitsRole(k, role));
    return ai.orderMode === 'custom' ? keys : [...keys].sort((a, b) => qualityScore(b, model(b)) - qualityScore(a, model(a)));
  };
  return { research: order(ai.researchProviders, 'research'), writer: order(ai.writerProviders, 'writer'), image: order(ai.imageProviders, 'image') };
}

// Whether AI generation can run, for the Content Studio (admin, editor).
async function readiness() {
  const settings = (await SiteSettings.getSingleton()).ai;
  const research = await providerChain(settings, 'research');
  const writer = await providerChain(settings, 'writer');
  let reason = '';
  if (!research.chain.length) reason = `No research provider is ready (research needs web search: Gemini, OpenAI, Anthropic, or the free Tavily search). ${research.skipped.join('; ')}`.trim();
  else if (!writer.chain.length) reason = `No writing provider is ready. ${writer.skipped.join('; ')}`.trim();
  const images = await providerChain(settings, 'image');
  const describe = (c) => c.chain.map((p) => ({ key: p.key, name: p.info.name, model: p.model }));
  return { ready: !reason, reason, research: describe(research), writer: describe(writer), images: settings.imagesEnabled ? describe(images) : [] };
}

export const aiStatus = asyncHandler(async (_req, res) => {
  res.json(await readiness());
});

// ---------- Providers (admin) ----------
export const providerUpdateSchema = z.object({
  apiKey: z.string().trim().min(10, 'That does not look like a complete API key').max(400).optional(),
  model: z.string().trim().max(200).optional(),
  enabled: z.boolean().optional(),
  baseUrl: z.string().trim().max(300).regex(/^($|https?:\/\/)/, 'Must be an http(s) URL').optional(),
});

export const listProviders = asyncHandler(async (_req, res) => {
  res.json({ items: await Promise.all(SUPPORTED.map(providerView)), secretsKeyConfigured: Boolean(env.SECRETS_KEY) });
});

const assertProvider = (key) => {
  if (!SUPPORTED.includes(key)) throw notFound('Unknown or unsupported AI provider');
};

export const updateProvider = asyncHandler(async (req, res) => {
  const { key } = req.params;
  assertProvider(key);
  const doc = (await AIProvider.findOne({ key })) || new AIProvider({ key, isDefault: key === 'gemini' });
  const changes = [];
  if (req.body.baseUrl !== undefined && key === 'ollama' && req.body.baseUrl !== doc.baseUrl) {
    doc.baseUrl = req.body.baseUrl.replace(/\/+$/, '');
    changes.push(`address set to ${doc.baseUrl || 'default'}`);
  }
  if (req.body.apiKey && PROVIDER_INFO[key].keyless) throw badRequest(`${PROVIDER_INFO[key].name} does not use an API key`);
  if (req.body.apiKey) {
    doc.apiKey = encryptSecret(req.body.apiKey);
    doc.apiKeyLast4 = req.body.apiKey.slice(-4);
    doc.lastTest = undefined;
    changes.push('API key replaced');
  }
  if (req.body.model && PROVIDER_INFO[key].modelless) throw badRequest(`${PROVIDER_INFO[key].name} does not use a model`);
  if (req.body.model !== undefined && req.body.model !== doc.model && !PROVIDER_INFO[key].modelless) {
    if (req.body.model) {
      const provider = await getActiveProvider(key);
      const apiKey = req.body.apiKey || provider.apiKey;
      const baseUrl = key === 'ollama' ? doc.baseUrl || provider.baseUrl : undefined;
      let models;
      try {
        models = await getAdapter(key).listModels({ apiKey, baseUrl });
      } catch (err) {
        throw aiErrorToHttp(err);
      }
      const m = models.find((x) => x.id === req.body.model);
      if (!m) throw badRequest(`The model "${req.body.model}" is not available to this API key`);
      doc.modelOutputLimit = m.outputTokenLimit || undefined;
    } else {
      doc.modelOutputLimit = undefined;
    }
    doc.model = req.body.model;
    changes.push(`model set to ${req.body.model || 'none'}`);
  }
  if (typeof req.body.enabled === 'boolean' && req.body.enabled !== doc.enabled) {
    doc.enabled = req.body.enabled;
    changes.push(req.body.enabled ? 'enabled' : 'disabled');
  }
  await doc.save();
  // A new key, model or setting gets a fresh chance: forget recent failures.
  if (changes.length) await clearHealthFor(key);
  // The key itself is never logged.
  await logActivity(req, 'ai.provider_update', { entityType: 'AIProvider', entityId: doc._id, summary: `${PROVIDER_INFO[key].name}: ${changes.join(', ') || 'no changes'}` });
  res.json({ item: await providerView(key) });
});

export const removeProviderKey = asyncHandler(async (req, res) => {
  const { key } = req.params;
  assertProvider(key);
  await AIProvider.updateOne({ key }, { $unset: { apiKey: 1, lastTest: 1 }, $set: { apiKeyLast4: '' } });
  await clearHealthFor(key);
  await logActivity(req, 'ai.provider_update', { entityType: 'AIProvider', summary: `${PROVIDER_INFO[key].name}: API key removed` });
  res.json({ item: await providerView(key) });
});

export const listProviderModels = asyncHandler(async (req, res) => {
  const { key } = req.params;
  assertProvider(key);
  if (PROVIDER_INFO[key].modelless) return res.json({ items: [] });
  const provider = await getActiveProvider(key);
  try {
    return res.json({ items: await getAdapter(key).listModels({ apiKey: provider.apiKey, baseUrl: provider.baseUrl }) });
  } catch (err) {
    throw aiErrorToHttp(err);
  }
});

export const testProvider = asyncHandler(async (req, res) => {
  const { key } = req.params;
  assertProvider(key);
  const provider = await getActiveProvider(key);
  let result;
  try {
    result = await getAdapter(key).testConnection({ apiKey: provider.apiKey, baseUrl: provider.baseUrl, model: provider.model });
  } catch (err) {
    result = { ok: false, message: err.message };
  }
  await AIProvider.updateOne({ key }, { $set: { lastTest: { at: new Date(), ok: result.ok, message: result.message.slice(0, 500) } } }, { upsert: true });
  if (result.ok) await clearHealth(key);
  res.json({ ok: result.ok, message: result.message, item: await providerView(key) });
});

// "Try now": forget recent failures so the provider is tried first again.
export const resetProviderHealth = asyncHandler(async (req, res) => {
  const { key } = req.params;
  assertProvider(key);
  await clearHealth(key);
  await logActivity(req, 'ai.provider_update', { entityType: 'AIProvider', summary: `${PROVIDER_INFO[key].name}: cooldown cleared, will be tried first again` });
  res.json({ item: await providerView(key) });
});

// ---------- AI settings (admin) ----------
export const aiSettingsSchema = z.object({
  maxResearchQuestions: z.number().int().min(1).max(10),
  maxSources: z.number().int().min(3).max(40),
  defaultLength: z.number().int().min(300).max(5000),
  defaultStyle: z.string().trim().max(120),
  defaultLanguage: z.string().trim().min(1).max(60),
  defaultCountry: z.string().trim().max(80),
  dailyJobLimit: z.number().int().min(1).max(200),
  outdatedAfterMonths: z.number().int().min(1).max(120),
  resultStatus: z.enum(['draft', 'pending_approval']),
  researchProviders: z
    .array(z.enum(PROVIDER_KEYS_SUPPORTED))
    .min(1, 'Choose at least one research provider')
    .refine((a) => new Set(a).size === a.length, 'A provider is listed twice')
    .refine((a) => a.every((k) => PROVIDER_INFO[k].supportsWebSearch), 'Research providers must support web search (Gemini, OpenAI or Anthropic)'),
  writerProviders: z
    .array(z.enum(PROVIDER_KEYS_SUPPORTED))
    .min(1, 'Choose at least one writing provider')
    .refine((a) => new Set(a).size === a.length, 'A provider is listed twice')
    .refine((a) => a.every((k) => !PROVIDER_INFO[k].searchOnly), 'Tavily is a search engine and cannot write; use it in the research list')
    .refine((a) => a.every((k) => PROVIDER_INFO[k].kind !== 'image'), 'Image sources cannot write; use them in the image list'),
  imageProviders: z
    .array(z.enum(PROVIDER_KEYS_SUPPORTED))
    .refine((a) => new Set(a).size === a.length, 'A source is listed twice')
    .refine((a) => a.every((k) => PROVIDER_INFO[k].kind === 'image'), 'Only image sources can be in the image list')
    .optional(),
  orderMode: z.enum(['quality', 'custom']).optional(),
  imagesEnabled: z.boolean().optional(),
  inlineImages: z.number().int().min(0).max(4).optional(),
});

export const getAiSettings = asyncHandler(async (_req, res) => {
  const ai = (await SiteSettings.getSingleton()).ai;
  res.json({ settings: ai, effective: await effectiveOrders(ai) });
});

export const updateAiSettings = asyncHandler(async (req, res) => {
  const s = await SiteSettings.getSingleton();
  const prev = s.toObject().ai;
  const body = Object.fromEntries(Object.entries(req.body).filter(([, v]) => v !== undefined));
  s.ai = {
    ...prev,
    ...body,
    knownProviders: prev.knownProviders,
    defaultStyle: plainText(req.body.defaultStyle),
    defaultLanguage: plainText(req.body.defaultLanguage),
    defaultCountry: plainText(req.body.defaultCountry),
  };
  await s.save();
  await logActivity(req, 'ai.settings_update', { entityType: 'SiteSettings', summary: 'Updated AI Content Studio settings' });
  res.json({ settings: s.ai, effective: await effectiveOrders(s.ai) });
});

// ---------- Jobs (admin, editor) ----------
export const jobCreateSchema = z
  .object({
    // Leave the topic empty to write about the website below.
    topic: z.string().trim().max(300).default(''),
    // An article about a website: it is read (home page and offering pages) and linked to.
    siteUrl: z
      .string()
      .trim()
      .max(500)
      .refine((v) => v === '' || /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(v), 'Enter the full website address, starting with https://')
      .default(''),
    sponsored: z.boolean().default(false),
    primaryKeyword: z.string().trim().max(120).default(''),
    secondaryKeywords: z.array(z.string().trim().min(1).max(120)).max(15).default([]),
    country: z.string().trim().max(80).default(''),
    language: z.string().trim().min(1).max(60).default('English'),
    audience: z.string().trim().max(300).default(''),
    length: z.number().int().min(300).max(5000).default(1500),
    style: z.string().trim().max(120).default(''),
    category: objectId.nullable().optional(),
    instructions: z.string().trim().max(3000).default(''),
  })
  .refine((b) => b.siteUrl || b.topic.length >= 5, { message: 'Describe the topic in a few words, or enter a website to write about', path: ['topic'] });

const JOB_LIST_FIELDS = 'input.topic input.primaryKeyword input.siteUrl status steps.key steps.status error article createdBy createdAt finishedAt usage model autopilot';

export const createJob = asyncHandler(async (req, res) => {
  try {
    const job = await startAiJob(req.body, req);
    res.status(201).json({ item: job });
  } catch (err) {
    if (err instanceof JobStartError) throw new HttpError(err.status, err.message);
    throw err;
  }
});

export const listJobs = asyncHandler(async (req, res) => {
  const paging = parsePaging(req.query, { defaultLimit: 20, maxLimit: 50 });
  const filter = {};
  if (['queued', 'running', 'completed', 'failed', 'cancelled'].includes(req.query.status)) filter.status = req.query.status;
  const [items, total] = await Promise.all([
    ResearchJob.find(filter).select(JOB_LIST_FIELDS).sort({ createdAt: -1 }).skip(paging.skip).limit(paging.limit).populate('createdBy', 'name').populate('article', 'title slug status').lean(),
    ResearchJob.countDocuments(filter),
  ]);
  res.json(paged(items, total, paging));
});

export const getJob = asyncHandler(async (req, res) => {
  const job = await ResearchJob.findById(req.params.id)
    .select('-draftHtml -draftRaw -draftEdited -website.pages.text')
    .populate('createdBy', 'name')
    .populate('article', 'title slug status')
    .populate('input.category', 'name slug')
    .lean();
  if (!job) throw notFound('Job not found');
  const sources = await ResearchSource.find({ job: job._id }).sort({ createdAt: 1 }).lean();
  res.json({ item: job, sources });
});

export const cancelJob = asyncHandler(async (req, res) => {
  const job = await ResearchJob.findById(req.params.id);
  if (!job) throw notFound('Job not found');
  if (job.status === 'queued') {
    job.status = 'cancelled';
    job.finishedAt = new Date();
  } else if (job.status === 'running') {
    job.cancelRequested = true; // the runner stops at the next checkpoint
  } else {
    throw conflict(`This job is already ${job.status}`);
  }
  await job.save();
  await logActivity(req, 'ai.job_cancel', { entityType: 'ResearchJob', entityId: job._id, summary: `Cancelled AI job: ${job.input.topic}` });
  res.json({ item: job });
});

export const retryJob = asyncHandler(async (req, res) => {
  const job = await ResearchJob.findById(req.params.id);
  if (!job) throw notFound('Job not found');
  if (!['failed', 'cancelled'].includes(job.status)) throw conflict('Only failed or cancelled jobs can be retried');
  const ready = await readiness();
  if (!ready.ready) throw badRequest(`${ready.reason} Add an API key and model in AI Providers first.`);
  for (const step of job.steps) {
    if (step.status !== 'completed') {
      step.status = 'pending';
      step.error = '';
      step.message = '';
    }
  }
  // Questions that failed during research are tried again; finished ones are kept.
  job.research.forEach((r, i) => {
    if (r.error && job.steps.find((s) => s.key === 'research').status !== 'completed') job.research.set(i, { ...r.toObject(), answer: '', error: '' });
  });
  job.status = 'queued';
  job.error = '';
  job.cancelRequested = false;
  job.finishedAt = undefined;
  await job.save();
  await logActivity(req, 'ai.job_retry', { entityType: 'ResearchJob', entityId: job._id, summary: `Retried AI job: ${job.input.topic}` });
  res.json({ item: job });
});
