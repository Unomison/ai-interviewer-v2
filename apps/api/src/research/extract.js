/**
 * Milestone 7 — lightweight HTML → text extraction (spec Section 4.3, ADR 008).
 *
 * The spec suggests @mozilla/readability + jsdom for Node, but those are
 * heavy dependencies for a free-tier server doing a handful of pages per
 * run. This hand-rolled extractor (~90 lines, zero new dependencies)
 * strips scripts/styles/nav/boilerplate and keeps main content — good
 * enough for feeding an LLM summarizer, which is tolerant of noise.
 */

const ENTITY_MAP = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => {
      try {
        return String.fromCodePoint(parseInt(n, 10));
      } catch {
        return '';
      }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => {
      try {
        return String.fromCodePoint(parseInt(n, 16));
      } catch {
        return '';
      }
    })
    .replace(/&([a-zA-Z]+);/g, (_, name) => ENTITY_MAP[name] ?? `&${name};`);
}

/**
 * @returns {{ title: string, description: string, text: string }}
 */
export function htmlToText(html) {
  let s = String(html || '');

  const title = decodeEntities((s.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim().slice(0, 200);
  const descMatch =
    s.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ||
    s.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  const description = decodeEntities(descMatch ? descMatch[1] : '').trim().slice(0, 500);

  // Drop whole subtrees that are never main content.
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<template[\s\S]*?<\/template>/gi, ' ');
  s = s.replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
  s = s.replace(/<nav[\s\S]*?<\/nav>/gi, ' ');
  s = s.replace(/<footer[\s\S]*?<\/footer>/gi, ' ');
  s = s.replace(/<aside[\s\S]*?<\/aside>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');

  // Block-level elements become line breaks.
  s = s.replace(/<\/?(p|div|section|article|main|h[1-6]|li|tr|br|hr|blockquote|pre)[^>]*>/gi, '\n');
  // Strip remaining tags.
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);

  const lines = s
    .split('\n')
    .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    // Drop cookie/consent boilerplate lines and one-word crumbs.
    .filter((l) => l.length > 1 && !/^(accept|cookie|privacy policy|terms)/i.test(l));
  // Deduplicate repeated lines (menus, repeated CTAs).
  const seen = new Set();
  const deduped = lines.filter((l) => {
    if (seen.has(l)) return false;
    seen.add(l);
    return true;
  });
  return { title, description, text: deduped.join('\n') };
}

/** Hard cap on characters handed to the summarizer per page. */
export const MAX_CHARS_PER_PAGE = 6000;

export function truncateForPrompt(text, maxChars = MAX_CHARS_PER_PAGE) {
  const t = String(text || '');
  return t.length > maxChars ? t.slice(0, maxChars) + '\n[…truncated]' : t;
}
