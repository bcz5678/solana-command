
// ============================================================================
// tools/template-import/dom.ts
//
// Shared types and helpers for the import passes.
//
// linkedom's nodes are structurally compatible with the DOM subset used here.
// Typed locally so this package doesn't need "dom" in its tsconfig lib, and
// declared ONCE so the two detectors can hand elements to each other.
// ============================================================================
 
export interface El {
  tagName: string;
  id: string;
  className: unknown;
  children: ArrayLike<El>;
  parentElement: El | null;
  textContent: string | null;
  getAttribute(name: string): string | null;
  querySelector(selector: string): El | null;
  querySelectorAll(selector: string): ArrayLike<El>;
}
 
export const tag = (el: El | null | undefined): string =>
  (el?.tagName ?? "").toLowerCase();
 
/** Collapsed whitespace — source markup is indented, content is not. */
export const text = (el: El | null | undefined): string =>
  (el?.textContent ?? "").replace(/\s+/g, " ").trim();
 
export const kids = (el: El | null | undefined): El[] =>
  Array.from(el?.children ?? []);
 
/** SVG elements expose className as an object, not a string. */
export function classesOf(el: El | null | undefined): Set<string> {
  const raw = el?.className;
  if (typeof raw !== "string") return new Set();
  return new Set(raw.split(/\s+/).filter(Boolean));
}
 
export const cssEscape = (value: string): string =>
  value.replace(/([^\w-])/g, "\\$1");
 
export const truncate = (value: string, max = 60): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;
 
/** Shortest stable-ish selector for an element: id, then class, then structural. */
export function cssPath(el: El): string {
  if (el.id) return `#${cssEscape(el.id)}`;
 
  const cls = [...classesOf(el)][0];
  if (cls) return `.${cssEscape(cls)}`;
 
  const parent = el.parentElement;
  if (!parent || tag(parent) === "body") return tag(el);
 
  return `${cssPath(parent)} > ${tag(el)}`;
}
 
/** Selector relative to an ancestor, for slots inside a section or a clone. */
export function relativeSelector(el: El, root: El): string {
  const parts: string[] = [];
  let cursor: El | null = el;
 
  while (cursor && cursor !== root) {
    const cls = [...classesOf(cursor)][0];
    if (cls) { parts.unshift(`.${cssEscape(cls)}`); break; }
 
    const siblings = kids(cursor.parentElement).filter(
      (c) => tag(c) === tag(cursor as El),
    );
    const index = siblings.indexOf(cursor);
 
    parts.unshift(
      siblings.length > 1 ? `${tag(cursor)}:nth-of-type(${index + 1})` : tag(cursor),
    );
    cursor = cursor.parentElement;
  }
 
  return parts.join(" > ") || tag(el);
}
 
export function contains(ancestor: El, node: El): boolean {
  let cursor: El | null = node.parentElement;
  while (cursor) {
    if (cursor === ancestor) return true;
    cursor = cursor.parentElement;
  }
  return false;
}
 