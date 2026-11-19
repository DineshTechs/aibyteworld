import { z } from 'zod';
import { logger } from '../../config/logger.js';
import { getAdapter } from '../../integrations/ai/index.js';
import { AiError, withRetry } from '../../integrations/ai/errors.js';
import { stripFences } from '../../integrations/ai/gemini.js';
import { Article, Category, ResearchJob, ResearchSource, SiteSettings } from '../../models/index.js';
import { excerptFrom, htmlToText, makeSlug, plainText, readingTimeMinutes, sanitizeArticleHtml, uniqueSlug } from '../../utils/content.js';
import { extractPageMeta, safeFetch } from '../../utils/safeFetch.js';
import { logActivity } from '../activityService.js';
import { applyCitations } from './citations.js';
import { analysisPrompt, editingPrompt, planningPrompt, researchPrompt, seoPrompt, verificationPrompt, writingPrompt, factFixPrompt } from './prompts.js';
import { extractFaq, findAiPhrases, newNumbers, polishWording, readability } from '../../utils/writingQuality.js';
import { providerChain } from './providerService.js';
import { runWithFailover } from './routing.js';
import { applyFactFixes, factFixSchema, findUncited } from './factFix.js';
import { extractionPrompt, extractionSchema, verifyExtraction } from './searchResearch.js';
import { controlLinks, readWebsite, websiteNotes } from './websiteReader.js';
import { addImages } from '../images/imageService.js';
import { linkNewContent } from '../seo/internalLinks.js';
import { publicBase } from '../growth/common.js';
import { guessCategories } from '../categories.js';

export class JobCancelled extends Error {}

const str = (max) => z.preprocess((v) => (v == null ? '' : String(v)), z.string()).transform((s) => s.trim().slice(0, max));
const strList = (maxItems, maxLen) => z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.any())).transform((a) => a.map((x) => String(x ?? '').trim().slice(0, maxLen)).filter(Boolean).slice(0, maxItems));

const analysisSchema = z.object({
  searchIntent: str(30),
  intentSummary: str(600),
  audience: str(400),
  primaryKeyword: str(120),
  secondaryKeywords: strList(12, 120),
  outline: z.array(z.object({ heading: str(200), points: strList(8, 300) })).min(2).transform((a) => a.slice(0, 10)),
  researchQuestions: strList(10, 400).refine((a) => a.length > 0, 'no research questions'),
});

const verificationSchema = z.object({
  summary: str(4000),
  conflicts: z.array(z.object({ findings: strList(6, 10), note: str(500) })).catch([]),
  outdated: z.array(z.object({ finding: str(10), note: str(500) })).catch([]),
});

const planSchema = z.object({
  title: str(200).refine((t) => t.length > 5, 'title missing'),
  sections: z
    .array(z.object({ heading: str(200), subheadings: strList(6, 200), findings: strList(30, 10), notes: str(800) }))
    .min(2)
    .transform((a) => a.slice(0, 10)),
  faq: z.array(z.object({ question: str(300), findings: strList(10, 10) })).catch([]),
  internalLinks: z.array(z.object({ slug: str(140), anchor: str(120), section: str(200) })).catch([]),
});

const today = () => new Date().toISOString().slice(0, 10);

const seoSchema = z.object({
  seoTitle: str(120),
  metaDescription: str(320),
  slug: str(140),
  focusKeyword: str(120),
  secondaryKeywords: strList(10, 120),
  ogTitle: str(120),
  ogDescription: str(300),
});

// Shortens text to `max` characters on a word boundary.
const clip = (t, max) => {
  const s = String(t || '').trim();
  if (s.length <= max) return s;
  return s.slice(0, max + 1).replace(/\s+\S*$/, '').replace(/[,;:\-–]+$/, '').trim();
};
const domainOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

// Grounding links point at a Google redirect; read the real page address from it.
async function resolveGroundingUrl(uri) {
  try {
    const host = new URL(uri).hostname;
    if (!/(^|\.)vertexaisearch\.cloud\.google\.com$/.test(host) && !/(^|\.)google\.com$/.test(host)) return uri;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(uri, { redirect: 'manual', signal: controller.signal });
      const loc = res.headers.get('location');
      if (loc && /^https?:\/\//i.test(loc)) return loc;
    } finally {
      clearTimeout(t);
    }
  } catch {
    /* keep the redirect link */
  }
  return uri;
}

async function inspectSource(url) {
  try {
    const res = await safeFetch(url, { timeoutMs: 8000, maxBytes: 600_000 });
    const meta = res.contentType.includes('html') ? extractPageMeta(res.body) : { publishedAt: null, title: '' };
    return { httpStatus: res.status, reachable: res.status < 400, finalUrl: res.url, ...meta };
  } catch {
    return { httpStatus: 0, reachable: false, finalUrl: url, publishedAt: null, title: '' };
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        // eslint-disable-next-line no-await-in-loop
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
}

// A post's categories: the one chosen for it (AI Content Studio, a fixed
// Autopilot category or the rotation) or the best match by topic; Autopilot's
// evergreen guides are also filed under Guides & How-tos.
async function postCategories(job, post) {
  const ids = job.input.category ? [job.input.category] : await guessCategories(post);
  if (job.autopilot?.kind === 'evergreen') {
    const guides = await Category.findOne({ slug: 'guides' }, '_id').lean();
    if (guides && !ids.some((x) => String(x) === String(guides._id))) ids.push(guides._id);
  }
  return ids;
}

export async function runPipeline(jobId) {
  const job = await ResearchJob.findById(jobId);
  if (!job) return;
  const settings = (await SiteSettings.getSingleton()).ai;
  const ctx = { today: today() };
  const chains = { research: await providerChain(settings, 'research'), writer: await providerChain(settings, 'writer'), image: await providerChain(settings, 'image') };
  const ROLE_NAMES = { research: 'research', writer: 'writing', image: 'images' };

  const isCancelled = async () => Boolean(await ResearchJob.exists({ _id: job._id, cancelRequested: true }));
  const heartbeat = () => ResearchJob.updateOne({ _id: job._id }, { $set: { lockedAt: new Date() } });
  const label = (p) => (p.info.modelless ? p.info.name : `${p.info.name} (${p.model})`);

  // Research with a search-only provider: search, then a writing model extracts
  // facts with exact quotes, which are checked against the result text.
  const searchResearch = async (step, p, adapter, opts, hasNext) => {
    const question = opts.question || '';
    const results = await withRetry(() => adapter.search({ apiKey: p.apiKey, query: question, maxResults: 6 }), { retries: hasNext ? 1 : 3, canRetry: (err) => !(hasNext && err.code === 'rate_limit') });
    job.usage.searchQueries += 1;
    if (!results.length) {
      return { text: '', grounding: { queries: [question], suggestionsHtml: '', chunks: [], supports: [] }, extractor: 'no results', usage: { promptTokens: 0, outputTokens: 0 } };
    }
    const ext = await gen(step, { ...extractionPrompt(question, results, { today: ctx.today, topic: job.input.topic }), json: true, temperature: 0.1, maxOutputTokens: 4096 }, extractionSchema, 'writer');
    const { grounding, dropped } = verifyExtraction(results, ext.json);
    grounding.queries = [question];
    if (dropped) logger.info({ job: String(job._id), dropped }, 'Discarded facts whose quotes were not found in the search results');
    return {
      text: grounding.supports.map((x) => x.text).join(' ') + (dropped ? ` (${dropped} unverifiable fact(s) discarded)` : ''),
      grounding,
      extractor: step.provider || 'writing model',
      usage: { promptTokens: 0, outputTokens: 0 },
    };
  };

  // Records a provider switch on the job (shown on the job page).
  const recordSwitch = async (step, role, p, next, err) => {
    const reason = err.message.slice(0, 400);
    job.switches.push({ at: new Date(), step: step.key, from: label(p), to: label(next), reason });
    job.warnings = [...job.warnings.filter((w) => !w.startsWith(`Switched ${role} from ${label(p)}`)), `Switched ${role} from ${label(p)} to ${label(next)}: ${reason}`];
    logger.warn({ job: String(job._id), role, from: p.key, to: next.key, err: err.message }, 'AI provider failed; switching to the next one');
    step.message = `Switched to ${label(next)}`;
    await ResearchJob.updateOne({ _id: job._id, 'steps.key': step.key }, { $set: { 'steps.$.message': step.message } }).catch(() => {});
  };
  // Notes once per job that a better provider was skipped because it failed recently.
  const recordSkip = (role) => (cooling) => {
    for (const { p, h } of cooling) {
      const prefix = `Skipped ${p.info.name} for ${ROLE_NAMES[role]}`;
      if (job.warnings.some((w) => w.startsWith(prefix))) continue;
      job.warnings.push(`${prefix}: it failed recently (${h.message.slice(0, 140)}) and will be tried first again after ${new Date(h.until).toISOString().slice(11, 16)} UTC.`);
    }
  };

  // One model call: starts with the best provider that is not cooling down,
  // retries briefly, switches to the next provider on failure, counts usage and
  // validates JSON. Each call starts from the top again, so the best provider
  // is used as soon as it works again.
  const gen = async (step, opts, schema, role = 'writer') => {
    const { chain, skipped } = chains[role];
    if (!chain.length) {
      throw new AiError(`No ${role === 'research' ? 'research (web search)' : 'writing'} provider is ready. ${skipped.join('; ') || 'Configure one in AI Providers.'}`, { code: 'no_key' });
    }
    const { result, provider } = await runWithFailover(
      chain,
      role,
      async (p, { hasNext }) => {
        const adapter = getAdapter(p.key);
        if (p.info.searchOnly) {
          // Search engine + writing model; facts must quote the results verbatim.
          const res = await searchResearch(step, p, adapter, opts, hasNext);
          step.provider = `${p.info.name} + ${res.extractor}`;
          return res;
        }
        const outputCap = p.doc?.modelOutputLimit || 8192; // unknown limit: stay safe
        return withRetry(
          async () => {
            const r = await adapter.generate({ apiKey: p.apiKey, baseUrl: p.baseUrl, model: p.model, ...opts, maxOutputTokens: Math.min(opts.maxOutputTokens || 8192, outputCap) });
            job.usage.calls += 1;
            job.usage.promptTokens += r.usage.promptTokens;
            job.usage.outputTokens += r.usage.outputTokens;
            job.usage.searchQueries += r.grounding?.queries?.length || 0;
            if (schema) {
              const parsed = schema.safeParse(r.json);
              if (!parsed.success) throw new AiError(`${p.info.name}'s answer did not have the expected structure (${parsed.error.issues[0]?.path.join('.') || 'root'}).`, { retryable: true, code: 'bad_shape' });
              r.json = parsed.data;
            }
            return r;
          },
          {
            // With another provider to switch to, a rate limit switches at once and
            // other temporary errors (timeouts, 5xx) get one retry. The last provider
            // in the list waits and retries up to 3 times.
            retries: hasNext ? 1 : 3,
            canRetry: (err) => !(hasNext && err.code === 'rate_limit'),
            onRetry: (err, n, wait) => {
              step.message = `${p.info.name}: retry ${n} in ${Math.round(wait / 1000)}s: ${err.message}`.slice(0, 500);
              // updateOne (not save) so this never overlaps with the step's own save.
              ResearchJob.updateOne({ _id: job._id, 'steps.key': step.key }, { $set: { 'steps.$.message': step.message } }).catch(() => {});
              logger.warn({ job: String(job._id), step: step.key, provider: p.key, err: err.message }, 'AI call failed; retrying');
            },
          },
        );
      },
      { onSwitch: (p, next, err) => recordSwitch(step, role, p, next, err), onSkip: recordSkip(role) },
    );
    step.message = '';
    if (!provider.info.searchOnly) step.provider = label(provider);
    return result;
  };

  const steps = {
    async analysis(step) {
      // An article about a website: read the site first (once).
      if (job.input.siteUrl && !job.website?.pages?.length) {
        step.message = `Reading ${job.input.siteUrl}`;
        await job.save();
        job.website = await readWebsite(job.input.siteUrl);
        job.markModified('website');
        if (job.input.topicAuto) job.input.topic = `${job.website.name}: what it offers and who it is for`.slice(0, 300);
        await job.save();
      }
      const p = analysisPrompt(job.input, { today: ctx.today, maxQuestions: settings.maxResearchQuestions, website: job.website });
      const r = await gen(step, { ...p, json: true, temperature: 0.3, maxOutputTokens: 8192 }, analysisSchema);
      r.json.researchQuestions = r.json.researchQuestions.slice(0, settings.maxResearchQuestions);
      if (job.input.primaryKeyword) r.json.primaryKeyword = job.input.primaryKeyword;
      job.analysis = r.json;
      job.markModified('analysis');
      step.message = `${r.json.researchQuestions.length} research questions, ${r.json.outline.length} sections`;
    },

    async research(step) {
      const questions = job.analysis.researchQuestions;
      let sourceCount = await ResearchSource.countDocuments({ job: job._id });
      // Stores grounded facts as findings, each tied to its source pages.
      const storeGrounding = async (g, question) => {
        // Map each grounding chunk to a stored source (up to maxSources per job).
        const resolved = await mapLimit(g.chunks, 4, (c) => resolveGroundingUrl(c.uri));
        const chunkSource = new Array(g.chunks.length).fill(null);
        for (let ci = 0; ci < g.chunks.length; ci += 1) {
          const url = resolved[ci];
          if (!/^https?:\/\//i.test(url)) continue;
          // eslint-disable-next-line no-await-in-loop
          let src = await ResearchSource.findOne({ job: job._id, url });
          if (!src) {
            if (sourceCount >= settings.maxSources) continue;
            // eslint-disable-next-line no-await-in-loop
            const info = await inspectSource(url);
            // eslint-disable-next-line no-await-in-loop
            src = await ResearchSource.create({
              job: job._id,
              url,
              domain: domainOf(url) || plainText(g.chunks[ci].title),
              title: plainText(info.title || g.chunks[ci].title).slice(0, 300),
              publishedAt: info.publishedAt || undefined,
              publishedAtSource: info.publishedAt ? 'page' : 'unknown',
              httpStatus: info.httpStatus,
              reachable: info.reachable,
            });
            sourceCount += 1;
          }
          chunkSource[ci] = src;
        }
        const seen = new Set(job.findings.map((f) => f.text));
        for (const sup of g.supports) {
          const text = plainText(sup.text).slice(0, 2000);
          const srcs = [...new Set(sup.chunkIndices.map((i) => chunkSource[i]).filter(Boolean))];
          if (text.length < 20 || !srcs.length || seen.has(text)) continue;
          seen.add(text);
          job.findings.push({
            fid: `F${job.findings.length + 1}`,
            text,
            question,
            sources: srcs.map((s) => s._id),
            domains: [...new Set(srcs.map((s) => s.domain))],
            confidence: sup.confidence ?? undefined,
          });
        }
      };

      // An article about a website: facts from its own pages first, each with a
      // word-for-word quote checked against the page text.
      if (job.website?.pages?.length && !job.website.factsDone) {
        const name = job.website.name;
        const pages = job.website.pages.map((x) => ({ title: x.title || name, url: x.url, content: x.text }));
        const siteQuestions = [
          `What does ${name} offer: its products, services and main features?`,
          `What do ${name}'s plans or prices cost, and what does each include?`,
          `Who is ${name} for, how does it work, and who runs it?`,
        ];
        for (const q of siteQuestions) {
          if (await isCancelled()) throw new JobCancelled();
          step.message = `Reading ${job.website.domain}: ${q}`;
          await job.save();
          try {
            const ext = await gen(step, { ...extractionPrompt(q, pages, { today: ctx.today, topic: job.input.topic }), json: true, temperature: 0.1, maxOutputTokens: 4096 }, extractionSchema, 'writer');
            const { grounding } = verifyExtraction(pages, ext.json);
            if (grounding.supports.length) await storeGrounding(grounding, q);
          } catch (err) {
            if (!(err instanceof AiError)) throw err;
            job.warnings.push(`Reading ${job.website.domain} for "${q}" failed: ${err.message.slice(0, 160)}`);
          }
        }
        job.website.factsDone = true;
        job.markModified('website');
        await job.save();
      }
      for (let qi = 0; qi < questions.length; qi += 1) {
        if (job.research[qi]?.answer || job.research[qi]?.error) continue; // done before a restart
        if (await isCancelled()) throw new JobCancelled();
        await heartbeat();
        step.message = `Searching ${qi + 1} of ${questions.length}: ${questions[qi]}`;
        await job.save();

        const entry = { question: questions[qi], answer: '', queries: [], suggestionsHtml: '', error: '' };
        try {
          const r = await gen(step, { ...researchPrompt(job.input, questions[qi], ctx), question: questions[qi], webSearch: true, temperature: 0.2, maxOutputTokens: 4096 }, null, 'research');
          entry.answer = r.text.slice(0, 20000);
          const g = r.grounding;
          if (!g || !g.chunks.length || !g.supports.length) {
            entry.error = 'The answer did not cite any search results, so it was not used.';
          } else {
            entry.queries = g.queries;
            entry.suggestionsHtml = g.suggestionsHtml;
            await storeGrounding(g, questions[qi]);
          }
        } catch (err) {
          // Problems that affect every question stop the job at once.
          if (err instanceof AiError && ['auth', 'no_key', 'no_model', 'not_found', 'quota', 'not_running', 'unsupported'].includes(err.code)) throw err;
          if (err instanceof AiError && err.code === 'rate_limit' && qi === 0) throw err;
          entry.error = err.message;
        }
        if (qi < job.research.length) job.research.set(qi, entry);
        else job.research.push(entry);
        await job.save();
      }
      if (!job.findings.length) {
        const reasons = [...new Set(job.research.map((r) => r.error).filter(Boolean))].join(' ');
        throw new AiError(`Research found no facts backed by reliable sources, so no article was written. ${reasons}`.trim(), { code: 'no_findings' });
      }
      const counts = await ResearchSource.aggregate([{ $match: { job: job._id } }, { $count: 'n' }]);
      for (const f of job.findings) {
        // eslint-disable-next-line no-await-in-loop
        await ResearchSource.updateMany({ _id: { $in: f.sources } }, { $inc: { findingCount: 1 } });
      }
      step.message = `${job.findings.length} findings from ${counts[0]?.n || 0} sources`;
    },

    async verification(step) {
      const sources = new Map((await ResearchSource.find({ job: job._id }).lean()).map((s) => [String(s._id), s]));
      const cutoff = Date.now() - settings.outdatedAfterMonths * 30.4 * 86400000;
      const view = job.findings.map((f) => {
        const dates = f.sources.map((id) => sources.get(String(id))?.publishedAt).filter(Boolean).map((d) => new Date(d).getTime());
        f.corroboration = f.domains.length >= 2 ? 'multiple' : 'single';
        f.outdated = dates.length && dates.length === f.sources.length && Math.max(...dates) < cutoff ? `All supporting pages were published more than ${settings.outdatedAfterMonths} months ago.` : '';
        f.conflict = '';
        return { fid: f.fid, text: f.text, domains: f.domains, published: dates.length ? new Date(Math.max(...dates)).toISOString().slice(0, 10) : '' };
      });
      const r = await gen(step, { ...verificationPrompt(job.input, view, { today: ctx.today, outdatedAfterMonths: settings.outdatedAfterMonths }), json: true, temperature: 0.1, maxOutputTokens: 8192 }, verificationSchema);
      const byId = new Map(job.findings.map((f) => [f.fid, f]));
      for (const c of r.json.conflicts) {
        const ids = c.findings.filter((id) => byId.has(id));
        if (ids.length < 2) continue;
        for (const id of ids) byId.get(id).conflict = `${c.note} (see ${ids.filter((x) => x !== id).join(', ')})`.slice(0, 600);
      }
      for (const o of r.json.outdated) {
        const f = byId.get(o.finding);
        if (f && !f.outdated) f.outdated = o.note.slice(0, 600) || 'May be out of date.';
      }
      job.summary = r.json.summary;
      const multi = job.findings.filter((f) => f.corroboration === 'multiple').length;
      const conflicts = job.findings.filter((f) => f.conflict).length;
      const outdated = job.findings.filter((f) => f.outdated).length;
      step.message = `${multi} corroborated, ${job.findings.length - multi} single-source, ${conflicts} conflicting, ${outdated} possibly outdated`;
      if (job.findings.every((f) => f.outdated)) throw new AiError('Every finding looks out of date, so no article was written. Try a narrower or more current topic.', { code: 'all_outdated' });
    },

    async planning(step) {
      const existing = await Article.find({ status: 'published', translationOf: null, ...(job.input.refreshOf ? { _id: { $ne: job.input.refreshOf } } : {}) }).sort({ publishedAt: -1 }).limit(60).select('title slug').lean();
      const r = await gen(step, { ...planningPrompt(job.input, job.analysis, job.findings, job.summary, existing, ctx), json: true, temperature: 0.4, maxOutputTokens: 8192 }, planSchema);
      const slugs = new Set(existing.map((a) => a.slug));
      const fids = new Set(job.findings.map((f) => f.fid));
      r.json.internalLinks = r.json.internalLinks.filter((l) => slugs.has(l.slug)).slice(0, 5);
      r.json.sections.forEach((s) => {
        s.findings = s.findings.filter((id) => fids.has(id));
      });
      job.plan = r.json;
      job.markModified('plan');
      step.message = `${r.json.sections.length} sections, ${r.json.faq.length} FAQ, ${r.json.internalLinks.length} internal links`;
    },

    async writing(step) {
      const r = await gen(step, { ...writingPrompt(job.input, job.analysis, job.plan, job.findings, { ...ctx, website: job.website }), temperature: 0.8, maxOutputTokens: 32768, timeoutMs: 300000 });
      job.draftRaw = stripFences(r.text);
      job.draftEdited = '';
      job.draftHtml = '';
      const words = htmlToText(job.draftRaw).split(/\s+/).filter(Boolean).length;
      if (r.finishReason === 'MAX_TOKENS') job.warnings.push('The writing model reached its output limit, so the article may end abruptly.');
      step.message = `${words} words drafted`;
      // Jobs created before the editing step existed finish the draft here.
      if (!job.steps.some((x) => x.key === 'editing')) await finalizeDraft(job.draftRaw);
    },

    async editing(step) {
      const raw = job.draftRaw;
      let edited = '';
      let reason = '';
      try {
        const r = await gen(step, { ...editingPrompt(job.input, raw), temperature: 0.7, maxOutputTokens: 32768, timeoutMs: 300000 });
        edited = stripFences(r.text);
      } catch (err) {
        if (!(err instanceof AiError)) throw err;
        reason = `the editing model failed (${err.message.slice(0, 120)})`;
      }
      if (edited) {
        // The edit may only change wording. Reject it if facts or citations moved.
        const markers = (h) => (h.match(/\[F\d+\]/gi) || []).map((m) => m.toUpperCase());
        const before = new Set(markers(raw));
        const after = markers(edited);
        const kept = [...before].filter((m) => after.includes(m)).length;
        const invented = after.filter((m) => !before.has(m));
        const added = newNumbers(edited, [raw, ...job.findings.map((f) => f.text)]);
        const wRaw = htmlToText(raw).split(/\s+/).length;
        const wEdit = htmlToText(edited).split(/\s+/).length;
        if (invented.length) reason = `the edit invented citation markers (${invented.slice(0, 3).join(', ')})`;
        else if (before.size && kept / before.size < 0.9) reason = `the edit dropped ${before.size - kept} of ${before.size} citations`;
        else if (added.length) reason = `the edit introduced figures not in the research (${added.slice(0, 5).join(', ')})`;
        else if (wEdit < wRaw * 0.8) reason = `the edit cut the article from ${wRaw} to ${wEdit} words`;
      }
      const useEdit = edited && !reason;
      job.draftEdited = useEdit ? edited : raw;
      if (!useEdit) job.warnings.push(`The humanise pass was not used because ${reason || 'it returned nothing'}; the first draft was kept.`);
      await finalizeDraft(job.draftEdited);
      const q = job.quality;
      step.message = `${useEdit ? 'Edited' : 'Kept first draft'} · ${q.words} words · ${q.aiPhraseCount} AI-style phrase${q.aiPhraseCount === 1 ? '' : 's'}${q.readingEase !== null ? ` · reading ease ${q.readingEase}` : ''}`;
    },

    // Links each unsourced figure to the finding that states it, or rewrites
    // the sentence without it (see factFix.js). Never adds unverified numbers.
    async factcheck(step) {
      const src = job.draftEdited || job.draftRaw;
      const byFid = new Map(job.findings.map((f) => [f.fid.toUpperCase(), f]));
      const blocks = findUncited(src, new Set(byFid.keys()));
      if (!blocks.length) {
        step.message = 'No unsourced figures';
        return;
      }
      const fixes = new Map();
      let modelNote = '';
      try {
        const r = await gen(
          step,
          { ...factFixPrompt(job.input, blocks.map((b, i) => ({ id: i + 1, html: b.inner })), job.findings), json: true, temperature: 0.2, maxOutputTokens: 8192 },
          factFixSchema,
        );
        for (const p of r.json.paragraphs) if (p.id > 0) fixes.set(p.id, p.html);
      } catch (err) {
        if (!(err instanceof AiError)) throw err;
        modelNote = ' (the model failed, so unsourced sentences were removed)';
      }
      const res = applyFactFixes(src, blocks, fixes, byFid);
      job.draftEdited = res.html;
      await finalizeDraft(job.draftEdited);
      const parts = [];
      if (res.cited) parts.push(`${res.cited} linked to a source`);
      if (res.reworded) parts.push(`${res.reworded} reworded without the number`);
      if (res.removedSentences) parts.push(`${res.removedSentences} sentence${res.removedSentences === 1 ? '' : 's'} removed`);
      step.message = `Fixed ${res.fixed} paragraph${res.fixed === 1 ? '' : 's'}: ${parts.join(', ')}${modelNote}`;
    },

    async seo(step) {
      if (!job.draftHtml) await finalizeDraft(job.draftEdited || job.draftRaw);
      const text = htmlToText(job.draftHtml);
      const title = plainText(job.plan.title);
      const keyword = plainText(job.analysis.primaryKeyword || job.input.primaryKeyword);
      let meta = null;
      try {
        const r = await gen(step, { ...seoPrompt(job.input, job.analysis, title, text), json: true, temperature: 0.3, maxOutputTokens: 2048 }, seoSchema);
        meta = r.json;
      } catch (err) {
        if (!(err instanceof AiError)) throw err;
        job.warnings.push(`SEO metadata was generated from the article because the model failed (${err.message.slice(0, 120)}).`);
      }
      const firstSentence = (text.match(/^.{60,300}?[.!?](?=\s|$)/) || [text.slice(0, 155)])[0];
      const seo = {
        title: clip(meta?.seoTitle || title, 60),
        description: clip(meta?.metaDescription || firstSentence, 155),
        slug: makeSlug(meta?.slug || keyword || title).split('-').slice(0, 8).join('-'),
        focusKeyword: clip(meta?.focusKeyword || keyword, 120),
        secondaryKeywords: (meta?.secondaryKeywords?.length ? meta.secondaryKeywords : job.analysis.secondaryKeywords || []).map((k) => plainText(k)).filter(Boolean).slice(0, 8),
        ogTitle: clip(meta?.ogTitle || meta?.seoTitle || title, 70),
        ogDescription: clip(meta?.ogDescription || meta?.metaDescription || firstSentence, 200),
        faq: extractFaq(job.draftHtml),
      };
      const notes = [];
      if (keyword && !seo.title.toLowerCase().includes(keyword.toLowerCase())) notes.push('keyword not in SEO title');
      if (keyword && !seo.description.toLowerCase().includes(keyword.toLowerCase())) notes.push('keyword not in meta description');
      if (seo.description.length < 110) notes.push('meta description is short');
      if (!/<h2/i.test(job.draftHtml)) notes.push('no H2 headings');
      job.seo = seo;
      job.markModified('seo');
      step.message = `Title ${seo.title.length} chars · description ${seo.description.length} chars · ${seo.faq.length} FAQ${notes.length ? ` · check: ${notes.join(', ')}` : ''}`;
    },

    async images(step) {
      if (!job.draftHtml) await finalizeDraft(job.draftEdited || job.draftRaw);
      const site = await SiteSettings.getSingleton();
      await addImages({
        job,
        step,
        settings,
        chain: chains.image,
        appName: makeSlug(site.siteName || 'blog') || 'blog',
        // Wikimedia asks for a way to contact the site owner.
        contact: publicBase(site.siteUrl) || site.contactEmail || '',
        gen,
        isCancelled: async () => {
          if (await isCancelled()) throw new JobCancelled();
        },
        onSwitch: (p, next, err) => recordSwitch(step, 'images', p, next, err),
        onSkip: recordSkip('image'),
      });
    },

    async saving(step) {
      if (job.article && (await Article.exists({ _id: job.article }))) return;
      if (!job.draftHtml) await finalizeDraft(job.draftEdited || job.draftRaw);
      const sources = new Map((await ResearchSource.find({ job: job._id }).lean()).map((s) => [String(s._id), s]));
      const cited = [];
      for (const f of job.findings.filter((x) => x.used)) for (const id of f.sources) if (sources.has(String(id)) && !cited.some((c) => String(c) === String(id))) cited.push(id);
      // Links to related older posts (exact keyword phrases only).
      const linked = await linkNewContent(job.draftHtml, { excludeIds: job.input.refreshOf ? [job.input.refreshOf] : [], categories: job.input.category ? [job.input.category] : [] }).catch((err) => {
        logger.warn({ job: String(job._id), err: err.message }, 'Automatic internal links failed');
        return { html: job.draftHtml, added: [] };
      });
      if (linked.added.length) job.draftHtml = sanitizeArticleHtml(linked.html);
      const linkNote = linked.added.length ? ` · ${linked.added.length} internal link${linked.added.length === 1 ? '' : 's'} added` : '';
      const text = htmlToText(job.draftHtml);
      const seo = job.seo || {};
      const status = job.autopilot?.enabled ? 'pending_approval' : settings.resultStatus;
      const cover = (job.images || []).find((x) => x.role === 'cover');
      const coverImage = cover ? { url: cover.url, alt: cover.alt, width: cover.width, height: cover.height, credit: sanitizeArticleHtml(cover.credit || ''), ...(cover.variants?.length ? { variants: cover.variants } : {}) } : { url: '', alt: '' };
      const seoFields = {
        title: seo.title || '',
        description: seo.description || '',
        focusKeyword: seo.focusKeyword || plainText(job.analysis.primaryKeyword || job.input.primaryKeyword).slice(0, 120),
        secondaryKeywords: seo.secondaryKeywords || [],
        ogTitle: seo.ogTitle || '',
        ogDescription: seo.ogDescription || '',
        faq: seo.faq || extractFaq(job.draftHtml),
      };

      // A refresh keeps the original post (and its address); the new version waits on it for review.
      if (job.input.refreshOf) {
        const original = await Article.findById(job.input.refreshOf);
        if (!original) throw new AiError('The post being refreshed no longer exists.', { code: 'not_found' });
        original.refresh = { job: job._id, title: plainText(job.plan.title).slice(0, 200), content: job.draftHtml, seo: seoFields, sources: cited, featuredImage: coverImage, words: text.split(/\s+/).filter(Boolean).length, createdAt: new Date() };
        original.markModified('refresh');
        await original.save();
        job.article = original._id;
        step.message = `Updated version saved on the original post for review${linkNote}`;
        await logActivity({ user: { _id: job.createdBy, name: 'Refresh' } }, 'refresh.ready', { entityType: 'Article', entityId: original._id, summary: `Updated version of "${original.title}" is ready for review` });
        return;
      }
      const article = new Article({
        title: plainText(job.plan.title).slice(0, 200),
        content: job.draftHtml,
        contentText: text,
        excerpt: excerptFrom(text),
        excerptIsAuto: true,
        featuredImage: coverImage,
        readingTime: readingTimeMinutes(text),
        author: job.createdBy,
        // The category chosen in AI Content Studio or Autopilot, else the best match by topic.
        categories: await postCategories(job, { title: job.plan.title, keyword: seoFields.focusKeyword, text }),
        origin: 'ai',
        status,
        sources: cited,
        seo: seoFields,
        history: [{ action: 'created', by: job.createdBy, note: `Generated by ${job.autopilot?.enabled ? 'Autopilot' : 'AI Content Studio'} (job ${job._id})` }],
      });
      article.slug = await uniqueSlug(Article, seo.slug || article.title);
      await article.save();
      job.article = article._id;
      step.message = `${status === 'pending_approval' ? (job.autopilot?.enabled ? 'Saved; Autopilot checks run next' : 'Saved and waiting for approval') : 'Saved as a draft'}${linkNote}`;
      await logActivity({ user: { _id: job.createdBy, name: job.autopilot?.enabled ? 'Autopilot' : 'AI Content Studio' } }, 'ai.article_created', {
        entityType: 'Article',
        entityId: article._id,
        summary: `AI article "${article.title}" saved (${article.status})`,
      });
    },
  };

  // Applies citations to the final draft and records quality measures.
  async function finalizeDraft(draftHtml) {
    // Only real links: this blog's pages and the pages read on the website the
    // article is about. Made-up or other outside links are removed (text kept).
    const linked = controlLinks(draftHtml, job.website, { sponsored: job.input.sponsored });
    // Swap stock "AI" phrases for plain wording before citations are applied.
    const polished = polishWording(linked.html, job.input.language);
    const sourceHtml = polished.html;
    const sources = new Map((await ResearchSource.find({ job: job._id }).lean()).map((x) => [String(x._id), x]));
    const cited = applyCitations(sourceHtml, job.findings, sources);
    const { usedFindings, usedSourceIds, warnings } = cited;
    let { html } = cited;
    // An article about a website: a dated note before the Sources list (and a
    // disclosure at the top of sponsored posts). Added after the citation check,
    // which would otherwise flag the date as an unsourced figure.
    if (job.website?.url) {
      const notes = websiteNotes(job.website, { sponsored: job.input.sponsored });
      const at = html.lastIndexOf('<h2>Sources</h2>');
      html = `${notes.top}${at >= 0 ? `${html.slice(0, at)}${notes.bottom}${html.slice(at)}` : `${html}${notes.bottom}`}`;
    }
    job.findings.forEach((f) => {
      f.used = usedFindings.has(f.fid);
    });
    const rd = readability(sourceHtml, job.input.language);
    const phrases = findAiPhrases(htmlToText(sourceHtml));
    const aiPhraseCount = phrases.reduce((a, p) => a + p.count, 0);
    if (rd.words < job.input.length * 0.4) warnings.push(`The article is ${rd.words} words, well short of the ${job.input.length} requested.`);
    if (aiPhraseCount > Math.max(3, Math.round(rd.words / 400))) warnings.push(`${aiPhraseCount} AI-style phrases remain (${phrases.slice(0, 5).map((p) => p.phrase).join(', ')}). Reword them before publishing.`);
    const uncited = warnings.filter((w) => /without a citation/.test(w)).map((w) => Number(w.match(/^(\d+)/)?.[1] || 0))[0] || 0;
    job.draftHtml = html;
    job.quality = {
      ...rd,
      aiPhrases: phrases.slice(0, 15),
      aiPhraseCount,
      citedFindings: usedFindings.size,
      citedSources: usedSourceIds.length,
      uncitedFigureParagraphs: uncited,
    };
    job.markModified('quality');
    if (linked.removed) warnings.push(`${linked.removed} link${linked.removed === 1 ? '' : 's'} to outside pages that were not part of the research ${linked.removed === 1 ? 'was' : 'were'} removed (the text is kept).`);
    if (job.website?.url && !linked.kept) warnings.push(`The article has no links to ${job.website.domain} apart from the note at the end. Add some in the editor if you want them.`);
    const keep = job.warnings.filter((w) => w.startsWith('Switched') || w.startsWith('Skipped') || w.startsWith('The humanise pass') || w.startsWith('The writing model reached') || w.startsWith('Reading ') || w.startsWith('No screenshot') || w.startsWith('No site image'));
    job.warnings = [...keep, ...warnings];
  }

  job.startedAt = job.startedAt || new Date();
  for (const step of job.steps) {
    if (step.status === 'completed' || step.status === 'skipped') continue;
    if (await isCancelled()) throw new JobCancelled();
    await heartbeat();
    step.status = 'running';
    step.attempts += 1;
    step.startedAt = new Date();
    step.error = '';
    step.message = '';
    await job.save();
    try {
      await steps[step.key](step);
    } catch (err) {
      step.status = err instanceof JobCancelled ? 'pending' : 'failed';
      step.error = err instanceof JobCancelled ? '' : err.message;
      step.message = '';
      step.finishedAt = new Date();
      await job.save();
      throw err;
    }
    step.status = 'completed';
    step.finishedAt = new Date();
    await job.save();
  }
  job.status = 'completed';
  job.finishedAt = new Date();
  job.lockedAt = undefined;
  await job.save();
  await logActivity({ user: { _id: job.createdBy, name: 'AI Content Studio' } }, 'ai.job_completed', { entityType: 'ResearchJob', entityId: job._id, summary: `AI job finished: ${job.input.topic}` });
}
