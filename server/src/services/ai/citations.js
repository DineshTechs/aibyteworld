import { sanitizeArticleHtml } from '../../utils/content.js';

// A figure that needs a source: a percentage, an amount with a unit, money or a year.
export const FIGURE_RE = /\b\d{1,3}(?:[.,]\d+)?\s?(?:%|(?:percent|per cent|million|billion|thousand|crore|lakh)\b)|[$€£₹]\s?\d|\b(?:19|20)\d{2}\b/i;

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Turns [F#] markers into numbered source links and appends a Sources list.
 * findings: [{ fid, sources: [sourceId] }]; sources: Map(id -> { url, title, domain, publishedAt })
 * Returns { html, usedFindings:Set, usedSourceIds:[], warnings:[] }
 */
export function applyCitations(rawHtml, findings, sources) {
  const warnings = [];
  const byFid = new Map(findings.map((f) => [f.fid.toUpperCase(), f]));
  const refNumber = new Map(); // sourceId -> n
  const order = [];
  const usedFindings = new Set();
  let unknown = 0;

  let html = String(rawHtml || '')
    .replace(/<h1[^>]*>[\s\S]*?<\/h1>/gi, '')
    .replace(/((?:\[\s*F\d+(?:\s*,\s*F\d+)*\s*\])+)/gi, (group) => {
      const ids = group.match(/F\d+/gi) || [];
      const nums = [];
      for (const raw of ids) {
        const f = byFid.get(raw.toUpperCase());
        if (!f) {
          unknown += 1;
          continue;
        }
        usedFindings.add(f.fid);
        for (const sid of f.sources.map(String)) {
          if (!sources.has(sid)) continue;
          if (!refNumber.has(sid)) {
            refNumber.set(sid, order.length + 1);
            order.push(sid);
          }
          const n = refNumber.get(sid);
          if (!nums.includes(n)) nums.push(n);
        }
      }
      if (!nums.length) return '';
      return nums
        .sort((a, b) => a - b)
        .map((n) => {
          const s = sources.get(order[n - 1]);
          return `<sup><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(s.title || s.domain)}">[${n}]</a></sup>`;
        })
        .join('');
    });

  if (unknown) warnings.push(`${unknown} citation marker(s) referred to findings that do not exist and were removed.`);

  // Paragraphs with figures but no citation are flagged for the editor to check.
  const uncited = (html.match(/<(p|li)[^>]*>[\s\S]*?<\/\1>/gi) || []).filter((block) => {
    if (/<sup>/.test(block)) return false;
    return FIGURE_RE.test(block.replace(/<[^>]+>/g, ''));
  }).length;
  if (uncited) warnings.push(`${uncited} paragraph(s) contain figures or years without a citation. Check them before publishing.`);

  if (order.length) {
    const items = order
      .map((sid) => {
        const s = sources.get(sid);
        const date = s.publishedAt ? `, published ${new Date(s.publishedAt).toISOString().slice(0, 10)}` : '';
        return `<li><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title || s.domain)}</a> (${escapeHtml(s.domain)}${date})</li>`;
      })
      .join('');
    html += `<h2>Sources</h2><ol>${items}</ol>`;
  } else {
    warnings.push('The article does not cite any research sources.');
  }

  return { html: sanitizeArticleHtml(html), usedFindings, usedSourceIds: order, warnings };
}
