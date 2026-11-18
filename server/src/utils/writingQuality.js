import { htmlToText } from './content.js';

// Overused phrases that make text read as machine-written. Counted (not
// removed) so editors can see them; the editing pass is told to avoid them.
export const AI_PHRASES = [
  'delve', 'delves', 'delving', "in today's fast-paced", "in today's digital", 'ever-evolving', 'ever-changing',
  'tapestry', 'realm', 'game-changer', 'game changer', 'unlock the power', 'unlock the potential', 'harness the power',
  'seamless', 'seamlessly', 'leveraging', 'elevate', 'embark', 'navigate the', 'navigating the',
  "it's important to note", 'it is important to note', "it's worth noting", 'it is worth noting', 'in conclusion',
  'in summary', 'furthermore', 'moreover', 'cutting-edge', 'revolutionize', 'revolutionise', 'transformative',
  'a testament to', 'plays a crucial role', 'plays a pivotal role', 'pivotal', 'paramount', 'look no further',
  "whether you're a", 'in the world of', 'dive into', 'deep dive', 'at the end of the day', 'synergy', 'holistic',
  'bustling', 'meticulous', 'unparalleled', 'landscape', 'robust', 'empower', 'foster',
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function findAiPhrases(text) {
  const t = ` ${String(text || '').toLowerCase().replace(/[’]/g, "'")} `;
  const found = [];
  for (const phrase of AI_PHRASES) {
    const re = new RegExp(`(^|[^a-z])${escapeRe(phrase)}(?=[^a-z]|$)`, 'g');
    const count = (t.match(re) || []).length;
    if (count) found.push({ phrase, count });
  }
  return found.sort((a, b) => b.count - a.count);
}

function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

// Words, sentence length variety and Flesch reading ease (English only).
export function readability(html, language = 'English') {
  const text = htmlToText(String(html || '').replace(/\[F\d+\]/gi, ''));
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 3);
  const words = text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  const lengths = sentences.map((s) => s.split(/\s+/).length);
  const avg = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  const sd = lengths.length ? Math.sqrt(lengths.reduce((a, b) => a + (b - avg) ** 2, 0) / lengths.length) : 0;
  let readingEase = null;
  if (/^english$/i.test(language || 'English') && words.length && sentences.length) {
    const syl = words.reduce((a, w) => a + syllables(w), 0);
    readingEase = Math.round(206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (syl / words.length));
  }
  return { words: words.length, sentences: sentences.length, avgSentenceLength: Math.round(avg * 10) / 10, sentenceLengthVariation: Math.round(sd * 10) / 10, readingEase };
}

// Every number in `edited` must already appear in one of `allowedTexts`
// (the draft or the research). Returns the numbers that were introduced.
export function newNumbers(edited, allowedTexts) {
  const norm = (s) => String(s).replace(/,(?=\d{3}\b)/g, '');
  const nums = (s) => (norm(htmlToText(String(s).replace(/\[F\d+\]/gi, ''))).match(/\d+(?:\.\d+)?/g) || []);
  const allowed = new Set(allowedTexts.flatMap(nums));
  return [...new Set(nums(edited).filter((n) => !allowed.has(n)))];
}

// FAQ pairs from the article HTML: the "Frequently asked questions" H2,
// each H3 question and the paragraphs after it.
export function extractFaq(html) {
  const s = String(html || '');
  // English, or the Hindi heading used by translations.
  const start = s.search(/<h2[^>]*>\s*(?:(?:frequently asked questions|faqs?)\b|अक्सर पूछे जाने वाले)[^<]*<\/h2>/i);
  if (start < 0) return [];
  const rest = s.slice(start).replace(/^<h2[^>]*>[\s\S]*?<\/h2>/i, '');
  const section = rest.split(/<h2[^>]*>/i)[0];
  const out = [];
  const re = /<h3[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3[^>]*>|$)/gi;
  let m;
  while ((m = re.exec(section)) && out.length < 10) {
    const question = htmlToText(m[1]).slice(0, 300);
    const answer = htmlToText(m[2].replace(/<sup>[\s\S]*?<\/sup>/gi, '')).slice(0, 1200);
    if (question.length > 5 && answer.length > 10) out.push({ question, answer });
  }
  return out;
}

// ---------- Automatic wording clean-up ----------
// Safe, meaning-preserving swaps for stock phrases that models overuse and
// readers recognise as machine-written. Runs on the text between HTML tags
// only, so links, tags and [F#] citation markers are never touched. Numbers,
// names and claims are not changed. English only.
const SWAPS = [
  // Openers and fillers that add nothing: dropped, next word capitalised.
  [/\b(?:in today's|in today’s) (?:fast-paced|digital|ever-changing|ever-evolving|modern) (?:world|age|era|landscape),?\s*/gi, ''],
  [/\bit(?:'s| is) (?:important|worth|crucial) (?:to note|noting|to remember|remembering) that\s+/gi, ''],
  [/\bit(?:'s| is) (?:important|worth|crucial) (?:to note|noting)[,:]?\s+/gi, ''],
  [/\b(?:in conclusion|in summary|to sum up|all in all|ultimately),\s*/gi, ''],
  [/\b(?:furthermore|moreover|additionally),\s*/gi, 'also, '],
  [/\bat the end of the day,\s*/gi, ''],
  // Word swaps.
  [/\bdelv(?:e|ing) (?:deep(?:er)? )?into\b/gi, (m) => (/ing/i.test(m) ? 'looking at' : 'look at')],
  [/\bdelves (?:deep(?:er)? )?into\b/gi, 'looks at'],
  [/\b(?:take a )?deep dive into\b/gi, 'close look at'],
  [/\bdive into\b/gi, 'get into'],
  [/\butili[sz](?:e|es|ed|ing)\b/gi, (m) => ({ e: 'use', es: 'uses', ed: 'used', ing: 'using' })[m.toLowerCase().replace(/^utili[sz]/, '')] || 'use'],
  [/\butili[sz]ation\b/gi, 'use'],
  [/\bseamlessly\b/gi, 'smoothly'],
  [/\bseamless\b/gi, 'smooth'],
  [/\bcutting-edge\b/gi, 'latest'],
  [/\bgame[- ]changer\b/gi, 'big shift'],
  [/\brevolutioni[sz]e\b/gi, 'change'],
  [/\brevolutioni[sz]es\b/gi, 'changes'],
  [/\brevolutioni[sz]ing\b/gi, 'changing'],
  [/\bplays an? (?:crucial|pivotal|vital|key|significant) role in\b/gi, 'is central to'],
  [/\bunlock(?:s|ing)? the (?:full )?(?:power|potential) of\b/gi, (m) => (/ing/i.test(m) ? 'getting the most from' : /unlocks/i.test(m) ? 'gets the most from' : 'get the most from')],
  [/\bharness(?:es|ing)? the power of\b/gi, (m) => (/ing/i.test(m) ? 'using' : /es\b/i.test(m.split(' ')[0]) ? 'uses' : 'use')],
  [/\bnavigat(?:e|ing) the (?:complexities|complex world|world|landscape) of\b/gi, (m) => (/ing/i.test(m) ? 'dealing with' : 'deal with')],
  [/\b(?:the )?ever-(?:evolving|changing) (?:landscape|world) of\b/gi, 'the fast-moving world of'],
  [/\bever-evolving\b/gi, 'fast-moving'],
  [/\bin the realm of\b/gi, 'in'],
  [/\ba testament to\b/gi, 'proof of'],
  [/\bparamount\b/gi, 'essential'],
  [/\bunparalleled\b/gi, 'unmatched'],
  [/\bmeticulous(ly)?\b/gi, (m) => (/ly$/i.test(m) ? 'carefully' : 'careful')],
  [/\bholistic\b/gi, 'complete'],
  [/\bembark(?:s|ed|ing)? on\b/gi, (m) => (/ing/i.test(m) ? 'starting' : /ed\b/i.test(m) ? 'started' : /s\b/i.test(m.split(' ')[0]) ? 'starts' : 'start')],
  [/\blook no further\.?\s*/gi, ''],
];

function matchCase(original, replacement) {
  if (!replacement) return replacement;
  return /^[A-Z]/.test(original) ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement;
}

function polishText(text) {
  let t = text;
  for (const [re, rep] of SWAPS) {
    t = t.replace(re, (m, ...args) => {
      const r = typeof rep === 'function' ? rep(m, ...args) : rep;
      return matchCase(m, r);
    });
  }
  // A removed opener can leave a lower-case letter at a sentence start.
  t = t.replace(/([.!?]\s+)([a-z])/g, (_m, p, c) => p + c.toUpperCase());
  return t;
}

/**
 * Cleans overused phrases out of article HTML and limits em dashes (a
 * well-known sign of machine text) to about one per 250 words.
 * Returns { html, changes } where changes counts the edits made.
 */
export function polishWording(html, language = 'English') {
  const src = String(html || '');
  if (!/^english$/i.test(language || 'English')) return { html: src, changes: 0 };
  const parts = src.split(/(<[^>]+>)/);
  let changes = 0;
  const words = htmlToText(src).split(/\s+/).length;
  let dashesLeft = Math.max(1, Math.floor(words / 250));
  // Text right after an opening block tag starts a sentence.
  let atStart = true;
  const out = parts.map((part) => {
    if (part.startsWith('<')) {
      if (/^<(?:p|li|h[1-6]|td|th|blockquote)\b/i.test(part)) atStart = true;
      return part;
    }
    if (!part.trim()) return part;
    const original = part;
    let t = polishText(part);
    // Only re-capitalise where a removed opener left the sentence start in lower case.
    if (atStart && /^\s*[A-Z]/.test(original) && /^\s*[a-z]/.test(t)) t = t.replace(/^(\s*)([a-z])/, (_m, sp, c) => sp + c.toUpperCase());
    else if (atStart && t !== original && /^\s*[a-z]/.test(t) && !/^\s*[a-z]/.test(original)) t = t.replace(/^(\s*)([a-z])/, (_m, sp, c) => sp + c.toUpperCase());
    // Em dashes: keep a few, turn the rest into commas.
    t = t.replace(/\s*—\s*/g, (m) => {
      if (dashesLeft > 0) {
        dashesLeft -= 1;
        return m;
      }
      return ', ';
    });
    if (t !== original) changes += 1;
    atStart = false;
    return t;
  });
  return { html: out.join(''), changes };
}
