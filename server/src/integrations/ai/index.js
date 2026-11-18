import * as anthropic from './anthropic.js';
import * as gemini from './gemini.js';
import * as ollama from './ollama.js';
import { cerebras, groq, mistral, nous, openrouter } from './openaiCompatible.js';
import * as openai from './openai.js';
import * as tavily from '../search/tavily.js';
import { nasa, openverse, pexels, pixabay, unsplash, wikimedia } from '../images/stock.js';

// Registry of AI providers. LLM adapters expose listModels, generate and
// testConnection; generate({ webSearch: true }) returns citations normalised to
// { queries, suggestionsHtml, chunks, supports }. Tavily is a search engine
// only: the pipeline pairs it with a writing model that extracts quoted facts.
// Image sources (kind: 'image') find free photos for posts. No images are generated.
export const ADAPTERS = {
  gemini,
  openai,
  anthropic,
  tavily,
  nous,
  groq,
  cerebras,
  mistral,
  openrouter,
  ollama,
  unsplash,
  pexels,
  pixabay,
  openverse,
  wikimedia,
  nasa,
};

export const PROVIDER_INFO = {
  gemini: { name: 'Google Gemini', description: 'Research with Grounding with Google Search, and writing. Has a free tier with daily limits.', supportsWebSearch: true, free: 'Free tier', keyUrl: 'https://aistudio.google.com/apikey', envVar: 'GEMINI_API_KEY' },
  openai: { name: 'OpenAI', description: 'Research with OpenAI web search (Responses API), and writing.', supportsWebSearch: true, keyUrl: 'https://platform.openai.com/api-keys', envVar: 'OPENAI_API_KEY' },
  anthropic: { name: 'Anthropic Claude', description: 'Research with Claude web search, and writing.', supportsWebSearch: true, keyUrl: 'https://platform.claude.com/settings/keys', envVar: 'ANTHROPIC_API_KEY' },
  tavily: {
    name: 'Tavily search (free)',
    description: 'Free web search: 1,000 searches a month, no card. A writing model then extracts facts, and only facts quoted word for word from a search result are kept.',
    supportsWebSearch: true,
    searchOnly: true,
    modelless: true,
    free: 'Free plan',
    keyUrl: 'https://app.tavily.com',
    envVar: 'TAVILY_API_KEY',
  },
  nous: { name: 'Nous Research', description: 'Writing with Hermes and other models on Nous Portal. No web search.', supportsWebSearch: false, keyUrl: 'https://portal.nousresearch.com', envVar: 'NOUS_API_KEY' },
  groq: { name: 'Groq (free)', description: 'Fast open models (Llama, GPT-OSS, Qwen and others). Free plan with per-model daily limits, no card. Writing only.', supportsWebSearch: false, free: 'Free plan', keyUrl: 'https://console.groq.com/keys', envVar: 'GROQ_API_KEY' },
  cerebras: { name: 'Cerebras (free)', description: 'Very fast open models. Free tier with daily token limits and a smaller context window. Writing only.', supportsWebSearch: false, free: 'Free tier', keyUrl: 'https://cloud.cerebras.ai', envVar: 'CEREBRAS_API_KEY' },
  mistral: {
    name: 'Mistral (free)',
    description: 'Mistral models on the free Experiment plan (phone verification). Requests on the free plan may be used to train Mistral models, so avoid confidential topics. Writing only.',
    supportsWebSearch: false,
    free: 'Free plan',
    keyUrl: 'https://console.mistral.ai/api-keys',
    envVar: 'MISTRAL_API_KEY',
  },
  openrouter: { name: 'OpenRouter (free models)', description: 'Only models ending in ":free" are offered, so nothing is billed. 20 requests a minute and 50 a day (1,000 a day after a one-time $10 credit purchase). Writing only.', supportsWebSearch: false, free: 'Free models', keyUrl: 'https://openrouter.ai/settings/keys', envVar: 'OPENROUTER_API_KEY' },
  ollama: { name: 'Ollama (free, on this computer)', description: 'Free models running locally with Ollama. No API key and no web search, so it writes only. Speed depends on your computer.', supportsWebSearch: false, keyless: true, free: 'Free, local', keyUrl: 'https://ollama.com/download', envVar: '' },

  // ---------- Image sources ----------
  unsplash: {
    kind: 'image',
    imageType: 'stock',
    name: 'Unsplash (free photos)',
    description: 'High-quality free photos. Shown from Unsplash with photographer credit, as their API rules require. 50 requests an hour for new apps.',
    modelless: true,
    free: 'Free',
    keyUrl: 'https://unsplash.com/oauth/applications',
    envVar: 'UNSPLASH_ACCESS_KEY',
  },
  pexels: {
    kind: 'image',
    imageType: 'stock',
    name: 'Pexels (free photos)',
    description: 'Free stock photos, downloaded to your site with photographer credit. 200 searches an hour.',
    modelless: true,
    free: 'Free',
    keyUrl: 'https://www.pexels.com/api/',
    envVar: 'PEXELS_API_KEY',
  },
  pixabay: {
    kind: 'image',
    imageType: 'stock',
    name: 'Pixabay (free photos)',
    description: 'Free stock photos, downloaded to your site with credit. 100 requests a minute.',
    modelless: true,
    free: 'Free',
    keyUrl: 'https://pixabay.com/api/docs/',
    envVar: 'PIXABAY_API_KEY',
  },  openverse: {
    kind: 'image',
    imageType: 'stock',
    name: 'Openverse (free, no key)',
    description: 'Openly licensed photos from Flickr, Wikimedia Commons and museums. Only licences that allow commercial use; each photo is credited with its creator and licence. No API key needed. Tried first; the other libraries take over when it has no fitting photo.',
    modelless: true,
    keyless: true,
    free: 'Free, no key',
    keyUrl: 'https://openverse.org',
    envVar: '',
  },
  wikimedia: {
    kind: 'image',
    imageType: 'stock',
    name: 'Wikimedia Commons (free, no key)',
    description: 'Millions of freely licensed photos from the Wikipedia media library. Only CC0, public domain, CC BY and CC BY-SA files without extra restrictions; each photo is credited with its author and licence. No API key needed.',
    modelless: true,
    keyless: true,
    free: 'Free, no key',
    keyUrl: 'https://commons.wikimedia.org',
    envVar: '',
  },
  nasa: {
    kind: 'image',
    imageType: 'stock',
    name: 'NASA Images (free, no key)',
    description: "NASA's photo library: space, science and engineering. NASA's own photos are generally not copyrighted; photos credited to news agencies are skipped. No API key needed. Tried last because it suits fewer topics.",
    modelless: true,
    keyless: true,
    free: 'Free, no key',
    keyUrl: 'https://images.nasa.gov',
    envVar: '',
  },

};

export const PROVIDER_KEYS_SUPPORTED = Object.keys(ADAPTERS);

// Default fallback order: paid/primary first, free last.
export const DEFAULT_RESEARCH_ORDER = ['gemini', 'openai', 'anthropic', 'tavily'];
export const DEFAULT_WRITER_ORDER = ['gemini', 'openai', 'anthropic', 'nous', 'groq', 'cerebras', 'mistral', 'openrouter', 'ollama'];
export const DEFAULT_IMAGE_ORDER = ['openverse', 'unsplash', 'pexels', 'wikimedia', 'pixabay', 'nasa'];
export const IMAGE_KEYS = DEFAULT_IMAGE_ORDER;

// Rough quality ranking used when "best quality first" is on. Frontier
// providers come first, then large open models, then small or local ones.
// Ties keep the admin's order.
const FRONTIER = new Set(['gemini', 'openai', 'anthropic']);
// Openverse first (owner's choice), then the key-based libraries.
const IMAGE_SCORES = { openverse: 75, unsplash: 70, pexels: 68, wikimedia: 66, pixabay: 62, nasa: 50 };
export function qualityScore(key, model = '') {
  if (IMAGE_SCORES[key]) return IMAGE_SCORES[key];
  if (key === 'tavily') return 50;
  const m = String(model).toLowerCase();
  let score = FRONTIER.has(key) ? 90 : key === 'ollama' ? 30 : 60;
  if (!FRONTIER.has(key)) {
    const size = Number((m.match(/(\d+(?:\.\d+)?)b(?![a-z])/) || [])[1] || 0);
    if (size >= 200) score += 15;
    else if (size >= 100) score += 12;
    else if (size >= 60) score += 8;
    else if (size >= 25) score += 3;
    else if (size > 0 && size < 15) score -= 12;
    if (/kimi-k2|deepseek|qwen-?3-235|gpt-oss-120|maverick|mistral-large|mistral-medium|magistral|hermes-4|glm-4\.[5-9]/.test(m)) score += 12;
  }
  if (/(^|[-_/:.])(mini|nano|lite|tiny|instant|small|haiku)([-_/:.]|$)/.test(m) || /flash-lite|flash-8b/.test(m)) score -= FRONTIER.has(key) ? 5 : 8;
  return Math.min(score, FRONTIER.has(key) ? 99 : 84);
}
export const qualityLabel = (score) => (score >= 80 ? 'Top quality' : score >= 60 ? 'Good' : 'Basic');

export function getAdapter(key) {
  const adapter = ADAPTERS[key];
  if (!adapter) throw new Error(`AI provider "${key}" is not supported`);
  return adapter;
}
