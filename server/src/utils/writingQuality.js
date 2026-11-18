import { htmlToText } from './content.js';

// Overused phrases that make text read as machine-written. Counted (not
// removed) so editors can see them; the editing pass is told to avoid them.
export const AI_PHRASES = [
  'delve', 'delves', 'delving', "in today's fast-paced", "in today's digital", 'ever-evolving', 'ever-changing',
  'tapestry', 'realm', 'game-changer', 'game changer', 'unlock the power', 'unlock the potential', 'harness the power',
  'seamless', 'seamlessly', 'leverage', 'leveraging', 'elevate', 'embark', 'navigate the', 'navigating the',
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
