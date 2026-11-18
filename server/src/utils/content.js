import sanitizeHtml from 'sanitize-html';
import slugifyLib from 'slugify';

// Article HTML is untrusted input (from the editor now, from AI/research later).
// Only a conservative allow-list of tags and attributes is stored.
const ARTICLE_OPTIONS = {
  allowedTags: [
    'h2', 'h3', 'h4', 'p', 'br', 'hr', 'blockquote', 'pre', 'code',
    'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'mark',
    'ul', 'ol', 'li', 'a', 'img', 'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'srcset', 'sizes', 'alt', 'title', 'width', 'height', 'loading'],
    th: ['colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
    code: ['class'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  transformTags: {
    a: (tagName, attribs) => {
      const out = { ...attribs };
      if (out.target === '_blank') out.rel = 'noopener noreferrer';
      else delete out.target;
      return { tagName, attribs: out };
    },
    img: (tagName, attribs) => ({ tagName, attribs: { ...attribs, loading: 'lazy' } }),
  },
};

export function sanitizeArticleHtml(html) {
  // Relative /uploads/... image URLs are allowed in addition to http(s).
  return sanitizeHtml(String(html || ''), {
    ...ARTICLE_OPTIONS,
    exclusiveFilter: (frame) =>
      frame.tag === 'img' && !/^(https?:\/\/|\/uploads\/)/i.test(frame.attribs.src || ''),
  });
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&nbsp;': ' ' };

// Plain text with all markup removed. The result is NOT HTML: entities are
// decoded, so it must always be rendered as text (React does this by default).
export function htmlToText(html) {
  // Put a space at block boundaries so "<h2>A</h2><p>B</p>" becomes "A B", not "AB".
  const spaced = String(html || '').replace(/<\/(p|h[1-6]|li|blockquote|pre|figcaption|td|th|tr)>|<br\s*\/?>|<hr\s*\/?>/gi, '$& ');
  return sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} })
    .replace(/&(amp|lt|gt|quot|#39|#x27|nbsp);/g, (m) => ENTITIES[m])
    .replace(/\s+/g, ' ')
    .trim();
}

export const plainText = (s) => htmlToText(s);

export function readingTimeMinutes(text) {
  const words = String(text || '').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

export function makeSlug(value) {
  return slugifyLib(String(value || ''), { lower: true, strict: true, trim: true }).slice(0, 120);
}

export function excerptFrom(text, max = 180) {
  const t = String(text || '');
  if (t.length <= max) return t;
  return `${t.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

// Finds a slug not yet used in `Model` (optionally ignoring one document).
export async function uniqueSlug(Model, base, ignoreId) {
  const root = makeSlug(base) || 'untitled';
  let candidate = root;
  for (let i = 2; i < 500; i += 1) {
    const filter = { slug: candidate };
    if (ignoreId) filter._id = { $ne: ignoreId };
    // eslint-disable-next-line no-await-in-loop
    if (!(await Model.exists(filter))) return candidate;
    candidate = `${root}-${i}`;
  }
  return `${root}-${Date.now()}`;
}
