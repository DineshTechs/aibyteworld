import { z } from 'zod';
import { htmlToText } from '../../utils/content.js';
import { newNumbers } from '../../utils/writingQuality.js';
import { FIGURE_RE } from './citations.js';

// Fact fix: every paragraph or list item that states a figure (percentage,
// amount, money, year) without a citation is either linked to the research
// finding that states that figure, or rewritten without it. A rewrite is used
// only if it passes the checks below; otherwise the unsourced sentences are
// removed. No unverified number can reach a published post.

const BLOCK_RE = /<(p|li)\b[^>]*>[\s\S]*?<\/\1>/gi;
const MARKER_GROUP = /\[\s*F\d+(?:\s*,\s*F\d+)*\s*\]/gi;
const markersOf = (html) => (String(html).match(MARKER_GROUP) || []).flatMap((g) => g.match(/F\d+/gi)).map((m) => m.toUpperCase());
const textOf = (html) => htmlToText(String(html).replace(MARKER_GROUP, ' '));
const wordCount = (html) => textOf(html).split(/\s+/).filter(Boolean).length;

/** Blocks with a figure and no known citation marker: [{ start, end, open, inner, close }]. */
export function findUncited(html, knownFids) {
  const out = [];
  for (const m of String(html).matchAll(BLOCK_RE)) {
    const block = m[0];
    if (markersOf(block).some((f) => knownFids.has(f))) continue;
    if (!FIGURE_RE.test(textOf(block))) continue;
    const parts = block.match(/^(<(p|li)\b[^>]*>)([\s\S]*)(<\/\2>)$/i);
    if (!parts) continue;
    out.push({ start: m.index, end: m.index + block.length, open: parts[1], inner: parts[3], close: parts[4] });
  }
  return out;
}

/** Removes the sentences that contain a figure. Returns { html, removed } ('' when too little is left). */
export function stripFigures(block) {
  const sentences = block.inner.split(/(?<=[.!?])\s+(?=[A-Z0-9"“‘(<])/).filter((x) => x.trim());
  const keep = sentences.filter((x) => !FIGURE_RE.test(textOf(x)));
  const removed = sentences.length - keep.length;
  const inner = keep.join(' ').trim();
  if (wordCount(inner) < 5) return { html: '', removed: sentences.length };
  return { html: `${block.open}${inner}${block.close}`, removed };
}

/**
 * Accepts a rewritten paragraph only if:
 * - it cites only findings that exist;
 * - without a citation, it contains no figure at all;
 * - with citations, every number in it appears in the cited findings
 *   (small counts such as "3 steps" are allowed);
 * - it keeps at least 40% of the original words.
 */
export function validFix(originalInner, fixedInner, findingsByFid) {
  if (!fixedInner || !String(fixedInner).trim()) return false;
  if (wordCount(fixedInner) < Math.max(3, wordCount(originalInner) * 0.4)) return false;
  const fids = markersOf(fixedInner);
  if (fids.some((f) => !findingsByFid.has(f))) return false;
  if (!fids.length) return !FIGURE_RE.test(textOf(fixedInner));
  const allowed = fids.map((f) => findingsByFid.get(f).text || '');
  const extra = newNumbers(fixedInner, allowed).filter((n) => !(Number.isInteger(Number(n)) && Number(n) <= 12));
  return extra.length === 0;
}

export const factFixSchema = z.object({
  paragraphs: z.preprocess(
    (v) => (Array.isArray(v) ? v : []),
    z.array(z.object({ id: z.coerce.number().int(), html: z.preprocess((v) => (v == null ? '' : String(v)), z.string()) }).catch({ id: -1, html: '' })),
  ),
});

/**
 * Applies the fixes to the draft. fixes: Map(id -> inner HTML), ids from 1 in
 * the order of findUncited(). Returns { html, cited, reworded, removedSentences, removedBlocks, fixed }.
 */
export function applyFactFixes(html, blocks, fixes, findingsByFid) {
  let out = String(html);
  const stats = { cited: 0, reworded: 0, removedSentences: 0, removedBlocks: 0, fixed: blocks.length };
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const b = blocks[i];
    const fixed = fixes.get(i + 1);
    let replacement;
    if (fixed && validFix(b.inner, fixed, findingsByFid)) {
      replacement = `${b.open}${String(fixed).trim()}${b.close}`;
      if (markersOf(fixed).length) stats.cited += 1;
      else stats.reworded += 1;
    } else {
      const s = stripFigures(b);
      replacement = s.html;
      stats.removedSentences += s.removed;
      if (!s.html) stats.removedBlocks += 1;
    }
    out = out.slice(0, b.start) + replacement + out.slice(b.end);
  }
  // Lists left empty after removals.
  out = out.replace(/<(ul|ol)\b[^>]*>\s*<\/\1>/gi, '');
  return { html: out, ...stats };
}
