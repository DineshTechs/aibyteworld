export type Role = 'admin' | 'editor' | 'author';
export type ArticleStatus = 'draft' | 'pending_approval' | 'scheduled' | 'published' | 'archived';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  bio: string;
  avatarUrl: string;
  jobTitle?: string;
  links?: AuthorLinks;
  active: boolean;
  lastLoginAt?: string;
  createdAt: string;
}

export interface Ref {
  _id: string;
  name: string;
  slug: string;
}

export interface Category extends Ref {
  description?: string;
  articleCount?: number;
}

export interface Tag extends Ref {
  articleCount?: number;
}

export interface AuthorLinks {
  website: string;
  linkedin: string;
  twitter: string;
  github: string;
}

export interface AuthorRef {
  _id: string;
  name: string;
  avatarUrl?: string;
  bio?: string;
  jobTitle?: string;
  links?: Partial<AuthorLinks>;
}

export interface FeaturedImage {
  url: string;
  alt: string;
  width?: number;
  height?: number;
  credit?: string; // sanitized HTML, e.g. "Photo by X on Unsplash"
  variants?: { width: number; url: string }[]; // smaller WebP copies
}

export interface ArticleCardData {
  _id: string;
  title: string;
  slug: string;
  excerpt: string;
  featuredImage: FeaturedImage;
  author: AuthorRef | null;
  categories: Ref[];
  tags: Ref[];
  publishedAt?: string;
  readingTime: number;
  views: number;
  reads?: number;
  featured: boolean;
  language?: string;
  refreshedAt?: string;
}

export interface ArticleShare {
  channel: 'telegram' | 'x' | 'linkedin' | 'facebook';
  at: string;
  ok: boolean;
  ref?: string;
  error?: string;
}

export interface ArticleRefresh {
  job: string;
  title: string;
  content: string;
  words?: number;
  sources?: string[];
  createdAt: string;
}

export interface Seo {
  title: string;
  description: string;
  focusKeyword: string;
  canonicalUrl: string;
  noindex: boolean;
  ogTitle?: string;
  ogDescription?: string;
  secondaryKeywords?: string[];
  faq?: { question: string; answer: string }[];
}

export interface HistoryEntry {
  action: string;
  by?: { _id: string; name: string } | null;
  at: string;
  note?: string;
}

export interface Article extends ArticleCardData {
  content: string;
  sources?: SourceRef[];
  status: ArticleStatus;
  origin: 'manual' | 'ai';
  seo: Seo;
  scheduledAt?: string;
  createdAt: string;
  updatedAt: string;
  history?: HistoryEntry[];
  translationOf?: string;
  shares?: ArticleShare[];
  refresh?: ArticleRefresh;
}

export interface Paged<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface SiteSettings {
  siteName: string;
  tagline: string;
  description: string;
  siteUrl: string;
  contactEmail: string;
  contactAddress: string;
  social: { twitter: string; facebook: string; linkedin: string; instagram: string };
  pages: { about: string; privacy: string; terms: string };
  postsPerPage: number;
  allowIndexing: boolean;
  analytics: AnalyticsSettings;
  languages?: string[]; // other languages with published posts, e.g. ["hi"]
}

export interface AnalyticsSettings {
  enabled: boolean;
  gaMeasurementId: string;
  gtmContainerId?: string;
  consentBanner: boolean;
  // Admin settings only (not in the public settings).
  googleVerification?: string;
  bingVerification?: string;
}

export interface AnalyticsPost {
  _id: string;
  title: string;
  slug: string;
  status: string;
  views: number;
  reads: number;
  readRate: number;
  avgReadSeconds: number;
}

export interface AnalyticsTotals {
  views: number;
  reads: number;
  readRate: number;
  avgReadSeconds: number;
}

export interface AnalyticsOverview {
  days: number;
  totals: AnalyticsTotals;
  previous: AnalyticsTotals;
  series: { day: string; views: number; reads: number }[];
  mostViewed: AnalyticsPost[];
  mostRead: AnalyticsPost[];
  referrers: { host: string; views: number }[];
  allTime: { views: number; reads: number };
  tracking: boolean;
  googleAnalytics: boolean;
  searchConsole: boolean;
}

export interface MediaItem {
  _id: string;
  filename: string;
  originalName: string;
  url: string;
  mimeType: string;
  size: number;
  alt: string;
  storage?: 'local' | 'remote';
  origin?: 'upload' | 'stock';
  width?: number;
  height?: number;
  credit?: { text: string; html: string };
  provider?: string;
  uploadedBy?: { _id: string; name: string } | null;
  createdAt: string;
}

export interface ActivityItem {
  _id: string;
  actorName: string;
  action: string;
  entityType: string;
  summary: string;
  ip?: string;
  createdAt: string;
}

export interface Stats {
  total: number;
  published: number;
  draft: number;
  scheduled: number;
  pendingApproval: number;
  archived: number;
  aiGenerated: number;
  manual: number;
}

export interface HomeData {
  featured: ArticleCardData[];
  latest: ArticleCardData[];
  mostRead: ArticleCardData[];
  mostViewed: ArticleCardData[];
  popular: ArticleCardData[];
  trendingTags: Tag[];
  categorySections: { category: Category; articles: ArticleCardData[] }[];
}

// ---------- Phase 2: AI ----------
export interface SourceRef {
  _id: string;
  url: string;
  title: string;
  domain: string;
  publishedAt?: string;
  reachable?: boolean;
}

export interface ResearchSource extends SourceRef {
  publishedAtSource: 'page' | 'unknown';
  httpStatus?: number;
  findingCount: number;
  retrievedAt: string;
}

export interface AiProvider {
  key: string;
  name: string;
  description: string;
  supportsWebSearch: boolean;
  keyless?: boolean;
  modelless?: boolean;
  searchOnly?: boolean;
  free?: string;
  baseUrl: string;
  enabled: boolean;
  model: string;
  hasKey: boolean;
  apiKeyLast4: string;
  keySource: 'dashboard' | 'env' | 'none' | 'not_needed' | `shared:${string}`;
  keyUrl: string;
  lastTest: { at: string; ok: boolean; message: string } | null;
  kind: 'text' | 'image';
  imageType?: 'stock';
  keyFrom?: string;
  quality: { score: number; label: string };
  // Roles this provider is cooling down for after a recent failure.
  health: { role: 'research' | 'writer' | 'image'; until: string; code: string; message: string }[];
}

export interface AiModel {
  id: string;
  name: string;
  outputTokenLimit?: number;
}

export interface AiSettings {
  maxResearchQuestions: number;
  maxSources: number;
  defaultLength: number;
  defaultStyle: string;
  defaultLanguage: string;
  defaultCountry: string;
  dailyJobLimit: number;
  outdatedAfterMonths: number;
  resultStatus: 'draft' | 'pending_approval';
  researchProviders: string[];
  writerProviders: string[];
  imageProviders: string[];
  orderMode: 'quality' | 'custom';
  imagesEnabled: boolean;
  inlineImages: number;
}

export interface AiOrders {
  research: string[];
  writer: string[];
  image: string[];
}

export interface AiStatus {
  ready: boolean;
  reason: string;
  research: { key: string; name: string; model: string }[];
  writer: { key: string; name: string; model: string }[];
  images: { key: string; name: string; model: string }[];
}

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface JobStep {
  key: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  message: string;
  error: string;
  provider?: string;
}

export interface Finding {
  fid: string;
  text: string;
  question: string;
  sources: string[];
  domains: string[];
  confidence?: number;
  corroboration: 'multiple' | 'single';
  conflict: string;
  outdated: string;
  used: boolean;
}

export interface JobImage {
  role: 'cover' | 'inline';
  heading: string;
  url: string;
  alt: string;
  width?: number;
  height?: number;
  credit: string;
  provider: string;
}

export interface ResearchJob {
  _id: string;
  input: {
    topic: string;
    primaryKeyword: string;
    secondaryKeywords: string[];
    country: string;
    language: string;
    audience: string;
    length: number;
    style: string;
    category?: { _id: string; name: string; slug: string } | null;
    instructions: string;
    siteUrl?: string;
    sponsored?: boolean;
  };
  status: JobStatus;
  steps: JobStep[];
  model: string;
  website?: { name: string; url: string; domain: string; pages: { url: string; title: string }[] };
  analysis?: {
    searchIntent: string;
    intentSummary: string;
    audience: string;
    primaryKeyword: string;
    secondaryKeywords: string[];
    outline: { heading: string; points: string[] }[];
    researchQuestions: string[];
  };
  research: { question: string; answer: string; queries: string[]; suggestionsHtml: string; error: string }[];
  findings: Finding[];
  summary: string;
  plan?: { title: string; sections: { heading: string; subheadings: string[]; findings: string[] }[]; faq: { question: string }[] };
  warnings: string[];
  quality?: {
    words: number;
    avgSentenceLength: number;
    sentenceLengthVariation: number;
    readingEase: number | null;
    aiPhraseCount: number;
    aiPhrases: { phrase: string; count: number }[];
    citedFindings: number;
    citedSources: number;
    uncitedFigureParagraphs: number;
  };
  seo?: { title: string; description: string; slug: string; focusKeyword: string; secondaryKeywords: string[]; ogTitle: string; ogDescription: string; faq: { question: string; answer: string }[] };
  autopilot?: { enabled: boolean; trend: string; gate?: { passed: boolean; reasons: string[]; checkedAt: string }; published: boolean };
  switches?: { at: string; step: string; from: string; to: string; reason: string }[];
  article?: { _id: string; title: string; slug: string; status: ArticleStatus } | null;
  usage: { calls: number; promptTokens: number; outputTokens: number; searchQueries: number; images?: number };
  images?: JobImage[];
  error: string;
  cancelRequested: boolean;
  createdBy?: { _id: string; name: string } | null;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}
