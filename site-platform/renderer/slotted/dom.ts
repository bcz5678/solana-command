/**
 * Minimal structural typing over linkedom's DOM.
 *
 * linkedom's types don't align cleanly with lib.dom's, and importing lib.dom
 * into a server-only package pulls in a global namespace we don't want. This
 * covers everything the slotted path touches.
 *
 * Deliberately NOT `as never` at the call sites — never silences every future
 * error there, not just today's.
 */
export interface SlottedDocument {
  documentElement: SlottedElement;
  querySelector(selector: string): SlottedElement | null;
  querySelectorAll(selector: string): SlottedElement[];
  createElement(tagName: string): SlottedElement;
}

export interface SlottedElement {
  tagName: string;
  innerHTML: string;
  outerHTML: string;
  textContent: string | null;
  attributes: Array<{ name: string; value: string }>;
  /** Direct element children only — not text nodes, not descendants. */
  children: SlottedElement[];
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  remove(): void;
  cloneNode(deep: boolean): SlottedElement;
  querySelector(selector: string): SlottedElement | null;
  querySelectorAll(selector: string): SlottedElement[];
  appendChild(node: SlottedElement): void;
  parentNode: { insertBefore(node: SlottedElement, ref: SlottedElement | null): void } | null;
}