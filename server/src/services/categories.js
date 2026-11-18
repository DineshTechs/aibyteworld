import { logger } from '../config/logger.js';
import { Article, Category, ResearchJob, SiteSettings } from '../models/index.js';
import { htmlToText } from '../utils/content.js';

// The site's topic categories, and automatic filing of posts into them.
//
// Each post gets one main topic (AI News, AI in Business, Cybersecurity or
// Blockchain & Crypto, else Technology) plus "Guides & How-tos" when it is a
// practical guide. A category the admin chose in AI Content Studio is kept.

export const DEFAULT_CATEGORIES = [
  {
    slug: 'ai-news',
    name: 'AI News',
    description: 'What is happening in artificial intelligence: launches, deals, people, research and rules, and what they mean for you.',
  },
  {
    slug: 'ai-in-business',
    name: 'AI in Business',
    description: 'How companies and small businesses use AI: tools, costs, returns and practical results.',
  },
  {
    slug: 'cybersecurity',
    name: 'Cybersecurity',
    description: 'Threats, scams and breaches explained, with clear steps to protect yourself, your devices and your business.',
  },
  {
    slug: 'blockchain-crypto',
    name: 'Blockchain & Crypto',
    description: 'Blockchain, cryptocurrencies and Web3 explained by a developer: technology, markets, risks and rules.',
  },
  {
    slug: 'gadgets-devices',
    name: 'Gadgets & Devices',
    description: 'Smartphones, laptops, wearables and smart-home devices: launches, comparisons and buying advice.',
  },
  {
    slug: 'apps-software',
    name: 'Apps & Software',
    description: 'Apps, operating systems, browsers and software updates: what is new and how to get the most from it.',
  },
  {
    slug: 'cloud-data',
    name: 'Cloud & Data',
    description: 'Cloud services, data centres and data tools, and the infrastructure behind modern apps and AI.',
  },
  {
    slug: 'programming',
    name: 'Programming & Developers',
    description: 'Code, frameworks, open source and developer tools, from a working developer.',
  },
  {
    slug: 'space-science',
    name: 'Space & Science',
    description: 'Space missions, satellites and the science and research shaping future technology.',
  },
  {
    slug: 'ev-mobility',
    name: 'EVs & Mobility',
    description: 'Electric vehicles, batteries, charging and self-driving technology.',
  },
  {
    slug: 'guides',
    name: 'Guides & How-tos',
    description: 'Step-by-step guides and explainers that stay useful.',
  },
  {
    slug: 'technology',
    name: 'Technology',
    description: 'Technology news and explainers that do not fit a more specific topic.',
  },
];

// Words that point to each main topic. Matched as whole words, case-insensitive.
const TOPICS = {
  'blockchain-crypto': /\b(?:blockchains?|crypto|cryptocurrenc(?:y|ies)|bitcoin|btc|ethereum|ether|web3|defi|nfts?|stablecoins?|smart contracts?|solana|binance|coinbase|altcoins?|crypto ?exchanges?|crypto ?wallets?|tokeni[sz]ation|dao|layer[- ]2)\b/gi,
  cybersecurity: /\b(?:cyber ?security|cyber ?attacks?|cyber ?crime|secur(?:e|ity|ing)|hack(?:ers?|ing|ed)?|breach(?:es)?|malware|ransomware|phishing|vulnerabilit(?:y|ies)|attacks?|attackers?|scams?|fraud|passwords?|privacy|encrypt(?:ion|ed)|firewalls?|zero[- ]day|exploits?|threats?|intrusions?|spyware|2fa|two-factor)\b/gi,
  'ai-in-business': /\b(?:business(?:es)?|enterprises?|roi|return on investment|startups?|customer (?:support|service)|productivity|workflows?|marketing|sales|revenue|profits?|automat(?:e|es|ed|ing|ion)|budgets?|hiring|workplace|employees?|smbs?|firms?|retail(?:ers)?|cost savings|ebit)\b/gi,
  'gadgets-devices': /\b(?:smartphones?|phones?|iphones?|android phones?|pixel \d+|galaxy s\d+|laptops?|macbooks?|tablets?|ipads?|wearables?|smart ?watch(?:es)?|earbuds|headphones|gadgets?|cameras?|smart tvs?|tvs?|consoles?|playstation|xbox|vr headsets?|headsets?|smart home|smart speakers?|chipsets?|snapdragon)\b/gi,
  'apps-software': /\b(?:apps?|software|operating systems?|os|windows 1[01]|macos|ios \d+|android \d+|browsers?|chrome|firefox|extensions?|saas|software updates?|app store|play store|whatsapp|instagram|youtube|microsoft office|excel)\b/gi,
  'cloud-data': /\b(?:cloud|data cent(?:er|re)s?|aws|azure|google cloud|databases?|big data|data analytics|data warehouses?|servers?|storage|kubernetes|serverless|hosting|bandwidth)\b/gi,
  programming: /\b(?:programming|coding|coders?|developers?|code|python|javascript|typescript|rust|golang|java|github|open[- ]source|apis?|sdks?|frameworks?|software engineers?|devops|react|node\.js|compilers?)\b/gi,
  'space-science': /\b(?:space|nasa|isro|esa|rockets?|satellites?|spacex|starship|mars|moon|lunar|orbit(?:al)?|astronom(?:y|ers?)|telescopes?|physics|quantum|scien(?:ce|tists?)|chandrayaan|gaganyaan)\b/gi,
  'ev-mobility': /\b(?:electric vehicles?|evs?|electric cars?|tesla|batter(?:y|ies)|charging stations?|ev charging|self-driving|driverless|autonomous (?:vehicles?|cars?|driving)|robotaxis?|ola electric|tata motors|byd|e-scooters?|two-wheelers?)\b/gi,
  'ai-news': /\b(?:announc(?:e|es|ed|ement)|launch(?:es|ed)?|unveil(?:s|ed)?|introduc(?:es|ed)|releas(?:es|ed)|acqui(?:res|red|sition)|resign(?:s|ed|ation)|ceo|chief executive|funding|raised?|investors?|lawsuits?|regulat(?:ion|ors?)|bans?|exit|steps? down|ipo|partnership|deal|report(?:s|ed)?|warning|board)\b/gi,
};
// "Steps" counts only as guide wording ("5 steps", "simple steps", "steps to"), not "steps down".
const GUIDE = /\b(?:how to|how-to|guide|step[- ]by[- ]step|(?:\d+|simple|easy|quick|practical|key) steps|steps to|tips|tutorial|explained|beginner'?s?|checklist|ways to|what is|best .* for)\b/i;

const count = (re, text) => (String(text || '').match(re) || []).length;

/**
 * Picks category slugs for a post. Title words count most, then the focus
 * keyword and tags, then the opening of the text.
 */
export function guessCategorySlugs({ title = '', keyword = '', tags = [], text = '' }) {
  const head = `${keyword} ${tags.join(' ')}`;
  const body = String(text).slice(0, 2000);
  const scores = Object.fromEntries(
    Object.entries(TOPICS).map(([slug, re]) => [slug, count(re, title) * 3 + count(re, head) * 2 + Math.min(count(re, body), 6)]),
  );
  // News needs to be about AI or tech companies to count as AI news.
  if (!/\b(?:ai|artificial intelligence|openai|nvidia|google|microsoft|meta|anthropic|chatgpt|gemini|llms?|models?|chips?|agents?|agentic)\b/i.test(`${title} ${head} ${body}`)) scores['ai-news'] = 0;
  const [best, score] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  const out = [score >= 3 ? best : 'technology'];
  if (GUIDE.test(title) || /how-to|guide/i.test(tags.join(' '))) out.push('guides');
  return out;
}

/** Category ids for a post, using the site's categories (missing ones are skipped). */
export async function guessCategories(post) {
  const slugs = guessCategorySlugs(post);
  const found = await Category.find({ slug: { $in: slugs } }, '_id slug').lean();
  return slugs.map((s) => found.find((c) => c.slug === s)?._id).filter(Boolean);
}

/**
 * One-time setup (runs at server start): adds the default categories that do
 * not exist yet, files existing posts that have no topic or only
 * "Technology", and lets Autopilot choose the category itself if it was set
 * to Technology. Each step runs once; categories the admin later deletes or
 * renames are left alone.
 */
export async function setUpCategories() {
  const s = await SiteSettings.getSingleton();
  const done = new Set(s.setupDone || []);
  // v2 added more technology topics; sites set up with v1 get only those.
  if (done.has('categories-v2')) return false;
  const firstTime = !done.has('categories-v1');

  for (const c of DEFAULT_CATEGORIES) {
    // eslint-disable-next-line no-await-in-loop
    await Category.updateOne({ slug: c.slug }, { $setOnInsert: c }, { upsert: true });
  }
  const tech = await Category.findOne({ slug: 'technology' }, '_id').lean();

  const posts = await Article.find({}, 'title seo.focusKeyword tags categories contentText content').populate('tags', 'name').lean();
  let filed = 0;
  for (const p of posts) {
    const only = (p.categories || []).map(String);
    if (only.length > 1 || (only.length === 1 && only[0] !== String(tech?._id))) continue;
    // eslint-disable-next-line no-await-in-loop
    const ids = await guessCategories({ title: p.title, keyword: p.seo?.focusKeyword, tags: (p.tags || []).map((t) => t.name), text: p.contentText || htmlToText(p.content || '') });
    if (!ids.length) continue;
    // eslint-disable-next-line no-await-in-loop
    await Article.updateOne({ _id: p._id }, { $set: { categories: ids } });
    filed += 1;
  }

  const update = { $addToSet: { setupDone: { $each: ['categories-v1', 'categories-v2'] } } };
  if (firstTime && tech && String(s.autopilot?.category || '') === String(tech._id)) update.$set = { 'autopilot.category': null };
  await SiteSettings.updateOne({ _id: s._id }, update);
  logger.info(`Categories set up; ${filed} post(s) filed by topic`);
  return true;
}

// ---------- Autopilot rotation ----------
// What Autopilot searches for when it writes for a category. Categories the
// admin adds use their own name.
export const CATEGORY_FOCUS = {
  'ai-news': { niche: 'artificial intelligence news', keywords: ['AI', 'OpenAI', 'Google Gemini', 'Nvidia', 'AI regulation'] },
  'ai-in-business': { niche: 'AI in business', keywords: ['AI tools for business', 'AI automation', 'AI for small business', 'enterprise AI'] },
  cybersecurity: { niche: 'cybersecurity', keywords: ['data breach', 'ransomware', 'online scams', 'security update', 'privacy'] },
  'blockchain-crypto': { niche: 'blockchain and cryptocurrency', keywords: ['bitcoin', 'ethereum', 'crypto regulation', 'Web3', 'stablecoins'] },
  'gadgets-devices': { niche: 'smartphones and gadgets', keywords: ['smartphone launch', 'laptops', 'wearables', 'smart home devices'] },
  'apps-software': { niche: 'apps and software', keywords: ['app update', 'Windows', 'Android', 'iOS', 'browser'] },
  'cloud-data': { niche: 'cloud computing and data centres', keywords: ['cloud computing', 'data centers', 'AWS', 'Microsoft Azure', 'databases'] },
  programming: { niche: 'programming and developer tools', keywords: ['programming languages', 'developer tools', 'open source', 'GitHub', 'AI coding'] },
  'space-science': { niche: 'space and science', keywords: ['ISRO', 'NASA', 'SpaceX', 'satellites', 'quantum computing'] },
  'ev-mobility': { niche: 'electric vehicles and mobility', keywords: ['electric vehicles', 'EV batteries', 'EV charging', 'self-driving cars'] },
};

/** Autopilot settings narrowed to one category's subject. */
export function focusFor(cfg, category) {
  const f = CATEGORY_FOCUS[category.slug] || { niche: category.name, keywords: [category.name] };
  return { ...cfg, niche: f.niche, keywords: f.keywords };
}

/**
 * The categories in Autopilot's rotation, the one due next first: fewest
 * Autopilot posts planned for it in the last 7 days, then the one waited
 * longest. Empty when a fixed category is set.
 */
export async function rotationOrder(cfg, now = new Date()) {
  if (cfg.category) return [];
  const chosen = (cfg.rotationCategories || []).map(String);
  const pool = await Category.find(chosen.length ? { _id: { $in: chosen } } : { slug: { $nin: ['guides', 'technology'] } }, 'name slug').sort({ createdAt: 1, _id: 1 }).lean();
  if (!pool.length) return [];
  const since = new Date(now.getTime() - 7 * 86400000);
  const stats = await ResearchJob.aggregate([
    { $match: { 'autopilot.enabled': true, 'autopilot.category': { $in: pool.map((c) => c._id) } } },
    { $group: { _id: '$autopilot.category', week: { $sum: { $cond: [{ $gte: ['$createdAt', since] }, 1, 0] } }, last: { $max: '$createdAt' } } },
  ]);
  const by = new Map(stats.map((x) => [String(x._id), x]));
  return pool
    .map((c, i) => ({ c, i, week: by.get(String(c._id))?.week || 0, last: by.get(String(c._id))?.last?.getTime() || 0 }))
    .sort((a, b) => a.week - b.week || a.last - b.last || a.i - b.i)
    .map((x) => x.c);
}
