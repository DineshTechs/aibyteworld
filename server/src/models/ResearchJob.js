import mongoose from 'mongoose';

const { ObjectId, Mixed } = mongoose.Schema.Types;

export const JOB_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'];

export const PIPELINE_STEPS = [
  { key: 'analysis', label: 'Topic analysis' },
  { key: 'research', label: 'Internet research' },
  { key: 'verification', label: 'Research verification' },
  { key: 'planning', label: 'Article planning' },
  { key: 'writing', label: 'Article writing' },
  { key: 'editing', label: 'Humanise & edit' },
  { key: 'factcheck', label: 'Fact fix' },
  { key: 'seo', label: 'SEO optimisation' },
  { key: 'images', label: 'Images' },
  { key: 'saving', label: 'Save draft' },
];

const stepSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    status: { type: String, enum: ['pending', 'running', 'completed', 'failed', 'skipped'], default: 'pending' },
    attempts: { type: Number, default: 0 },
    startedAt: Date,
    finishedAt: Date,
    message: { type: String, default: '' },
    error: { type: String, default: '' },
    provider: { type: String, default: '' }, // provider/model that did this step
  },
  { _id: false },
);

// A fact taken from a grounded Google Search answer, tied to the pages Google
// reported as supporting it. Findings are never written by the model alone.
const findingSchema = new mongoose.Schema(
  {
    fid: { type: String, required: true }, // F1, F2 ...
    text: { type: String, required: true, maxlength: 2000 },
    question: { type: String, default: '' },
    sources: [{ type: ObjectId, ref: 'ResearchSource' }],
    domains: [{ type: String }],
    confidence: { type: Number },
    corroboration: { type: String, enum: ['multiple', 'single'], default: 'single' },
    conflict: { type: String, default: '' },
    outdated: { type: String, default: '' },
    used: { type: Boolean, default: false },
  },
  { _id: false },
);

const researchJobSchema = new mongoose.Schema(
  {
    input: {
      topic: { type: String, required: true, maxlength: 300 },
      primaryKeyword: { type: String, default: '', maxlength: 120 },
      secondaryKeywords: [{ type: String, maxlength: 120 }],
      country: { type: String, default: '', maxlength: 80 },
      language: { type: String, default: 'English', maxlength: 60 },
      audience: { type: String, default: '', maxlength: 300 },
      length: { type: Number, default: 1500 },
      style: { type: String, default: '', maxlength: 120 },
      category: { type: ObjectId, ref: 'Category' },
      instructions: { type: String, default: '', maxlength: 4000 },
      // Set for a refresh: the published article this job writes an updated version of.
      refreshOf: { type: ObjectId, ref: 'Article' },
    },
    status: { type: String, enum: JOB_STATUSES, default: 'queued' },
    steps: { type: [stepSchema], default: () => PIPELINE_STEPS.map((s) => ({ ...s })) },
    provider: { type: String, default: 'gemini' },
    model: { type: String, default: '' },
    analysis: { type: Mixed },
    research: [
      {
        _id: false,
        question: String,
        answer: String,
        queries: [String],
        suggestionsHtml: String, // Google Search Suggestions (must be shown with grounded results)
        error: String,
      },
    ],
    findings: { type: [findingSchema], default: [] },
    summary: { type: String, default: '' },
    plan: { type: Mixed },
    draftRaw: { type: String, default: '' }, // first draft with [F#] markers
    draftEdited: { type: String, default: '' }, // after the humanise/edit pass
    draftHtml: { type: String, default: '' }, // final HTML with citations, kept so a failed save can resume
    quality: { type: Mixed }, // words, readability, AI-style phrases, citation counts
    seo: { type: Mixed }, // generated SEO metadata
    // Cover and in-article photos: { role: cover|inline, heading, url, alt, width, height, provider, credit, media }
    images: { type: [Mixed], default: [] },
    autopilot: {
      enabled: { type: Boolean, default: false },
      kind: { type: String, enum: ['trending', 'evergreen'], default: 'trending' },
      trend: { type: String, default: '' }, // the trending story the topic came from
      gate: { passed: Boolean, reasons: [String], checkedAt: Date },
      published: { type: Boolean, default: false },
    },
    warnings: [{ type: String }],
    switches: [{ _id: false, at: Date, step: String, from: String, to: String, reason: String }],
    article: { type: ObjectId, ref: 'Article' },
    usage: {
      calls: { type: Number, default: 0 },
      promptTokens: { type: Number, default: 0 },
      outputTokens: { type: Number, default: 0 },
      searchQueries: { type: Number, default: 0 },
      images: { type: Number, default: 0 },
    },
    error: { type: String, default: '' },
    cancelRequested: { type: Boolean, default: false },
    lockedAt: { type: Date },
    startedAt: { type: Date },
    finishedAt: { type: Date },
    createdBy: { type: ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

researchJobSchema.index({ status: 1, createdAt: 1 });
researchJobSchema.index({ createdAt: -1 });

export const ResearchJob = mongoose.model('ResearchJob', researchJobSchema);
