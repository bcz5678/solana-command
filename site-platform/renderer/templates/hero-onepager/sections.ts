// ============================================================================
// packages/site-renderer/src/templates/hero-onepager/sections.ts
//
// One renderer per section type in the manifest's supportedSectionTypes.
//
// This is what replaces div1_/div2_/div3_. The original could render exactly
// three sections, each with a fixed set of fields, because the field NAMES
// encoded position. Now the type discriminant selects a renderer and the
// section list is unbounded (within the manifest's sectionCount).
//
// EVERY interpolation of user content goes through esc/escAttr/safeUrl. There
// is no auto-escaping in a template-literal renderer, and all of this content
// originates in a public-facing form.
// ============================================================================

import type { SiteSection, SiteCta, ImageAsset } from "@site/schema";
import type { TemplateContext } from "../../types.js";
import { esc, escAttr, safeUrl, attrs } from "../../escape.js";

// ============================================================================
// SHARED PIECES
// ============================================================================

export function renderKicker(kicker: string | undefined): string {
  return kicker ? `<span class="kicker">${esc(kicker)}</span>` : "";
}

/** Paragraph list. Blank entries are dropped rather than emitting empty <p>. */
export function renderBody(body: string[] | undefined): string {
  if (!body?.length) return "";
  return body
    .filter((p) => p.trim())
    .map((p) => `<p>${esc(p)}</p>`)
    .join("\n        ");
}

/**
 * CTA button.
 *
 * External links get target + rel — absent throughout the original, which meant
 * every outbound link handed the opener reference to a third-party page.
 */
export function renderCta(cta: SiteCta | undefined): string {
  if (!cta?.label) return "";

  const variant =
    cta.variant === "secondary" ? " btn--secondary"
    : cta.variant === "outline" ? " btn--outline"
    : "";

  const external = cta.external
    ? ` target="_blank" rel="noopener noreferrer"`
    : "";

  return `<a class="btn${variant}" href="${safeUrl(cta.href)}"${external}>${esc(cta.label)}</a>`;
}

export function renderCtaRow(ctas: SiteCta[] | undefined): string {
  if (!ctas?.length) return "";
  return `<div class="cta-row">\n          ${ctas.map(renderCta).filter(Boolean).join("\n          ")}\n        </div>`;
}

/**
 * Image element.
 *
 * Always via ctx.imageUrl — reading asset.url directly would embed a signed
 * Supabase staging URL into the published page, where it expires and 403s.
 *
 * width/height are emitted to reserve space and prevent layout shift; loading
 * and decoding hints keep below-the-fold images off the critical path.
 */
export function renderImage(
  ctx: TemplateContext,
  asset: ImageAsset | undefined,
  className: string,
  eager = false,
): string {
  if (!asset) return "";

  const url = ctx.imageUrl(asset);
  if (!url) return "";

  return `<img${attrs({
    class: className,
    src: url,
    alt: asset.decorative ? "" : asset.alt,
    width: asset.width,
    height: asset.height,
    loading: eager ? "eager" : "lazy",
    decoding: "async",
    "aria-hidden": asset.decorative ? "true" : undefined,
  })}>`;
}

/**
 * Panel wrapper shared by the hero and every section.
 *
 * Background image and focal point ride as inline custom properties, so the
 * ::before rule in the stylesheet stays a single static declaration instead of
 * the original's one-class-per-section approach (.starship / .human / .network
 * — content-specific names hardcoded into a generic template).
 */
export function renderPanel(opts: {
  id?: string;
  extraClass?: string;
  backgroundUrl: string;
  focalX: number;
  focalY: number;
  overlayOpacity: number;
  backgroundColor?: string;
  align: string;
  inner: string;
}): string {
  const styles: string[] = [];

  if (opts.backgroundUrl) {
    // The URL is either a path we generated or a signed URL we issued, but it
    // still passes through escAttr on the way into the attribute.
    styles.push(`--section-bg: url('${escAttr(opts.backgroundUrl)}')`);
    styles.push(`--section-focus: ${(opts.focalX * 100).toFixed(1)}% ${(opts.focalY * 100).toFixed(1)}%`);
    styles.push(`--section-overlay: ${opts.overlayOpacity}`);
  }

  if (opts.backgroundColor) {
    styles.push(`background-color: ${escAttr(opts.backgroundColor)}`);
  }

  return `
    <section${attrs({
      id: opts.id,
      class: `panel${opts.extraClass ? ` ${opts.extraClass}` : ""}`,
      style: styles.join("; ") || undefined,
      "data-align": opts.align,
      "data-has-image": opts.backgroundUrl ? "true" : "false",
    })}>
      <div class="panel-content">
        ${opts.inner}
      </div>
    </section>`;
}

// ============================================================================
// PER-TYPE INNER CONTENT
// ============================================================================

function proseInner(section: Extract<SiteSection, { type: "prose" }>, ctx: TemplateContext): string {
  return [
    renderKicker(section.kicker),
    `<h2>${esc(section.title)}</h2>`,
    renderBody(section.body),
    section.media ? renderImage(ctx, section.media, "section-media") : "",
    renderCta(section.cta),
  ].filter(Boolean).join("\n        ");
}

function statsInner(section: Extract<SiteSection, { type: "stats" }>): string {
  const items = section.stats
    .map(
      (stat) => `
          <div class="stat">
            <div class="stat-value">${esc(stat.value)}${stat.suffix ? esc(stat.suffix) : ""}</div>
            <div class="stat-label">${esc(stat.label)}</div>
          </div>`,
    )
    .join("");

  return [
    renderKicker(section.kicker),
    `<h2>${esc(section.title)}</h2>`,
    section.intro ? `<p>${esc(section.intro)}</p>` : "",
    `<div class="stats-grid">${items}\n        </div>`,
  ].filter(Boolean).join("\n        ");
}

function timelineInner(section: Extract<SiteSection, { type: "timeline" }>): string {
  const items = section.milestones
    .map(
      (m) => `
          <li data-status="${escAttr(m.status ?? "upcoming")}">
            <span class="timeline-marker">${esc(m.marker)}</span>
            <h3>${esc(m.title)}</h3>
            ${m.body ? `<p>${esc(m.body)}</p>` : ""}
          </li>`,
    )
    .join("");

  return [
    renderKicker(section.kicker),
    `<h2>${esc(section.title)}</h2>`,
    section.intro ? `<p>${esc(section.intro)}</p>` : "",
    `<ol class="timeline">${items}\n        </ol>`,
  ].filter(Boolean).join("\n        ");
}

/**
 * FAQ via native <details>. No JavaScript, keyboard-accessible for free, and
 * findable by in-page search in browsers that support it.
 */
function faqInner(section: Extract<SiteSection, { type: "faq" }>): string {
  const items = section.items
    .map(
      (item) => `
          <details>
            <summary>${esc(item.question)}</summary>
            <p>${esc(item.answer)}</p>
          </details>`,
    )
    .join("");

  return [
    renderKicker(section.kicker),
    `<h2>${esc(section.title)}</h2>`,
    section.intro ? `<p>${esc(section.intro)}</p>` : "",
    `<div class="faq">${items}\n        </div>`,
  ].filter(Boolean).join("\n        ");
}

function cardsInner(section: Extract<SiteSection, { type: "cards" }>, ctx: TemplateContext): string {
  const items = section.cards
    .map(
      (card) => `
          <article class="card">
            ${card.image ? renderImage(ctx, card.image, "card-image") : ""}
            <h3>${esc(card.title)}</h3>
            ${card.body ? `<p>${esc(card.body)}</p>` : ""}
            ${renderCta(card.cta)}
          </article>`,
    )
    .join("");

  return [
    renderKicker(section.kicker),
    `<h2>${esc(section.title)}</h2>`,
    section.intro ? `<p>${esc(section.intro)}</p>` : "",
    `<div class="cards-grid">${items}\n        </div>`,
  ].filter(Boolean).join("\n        ");
}

// ============================================================================
// DISPATCH
// ============================================================================

/**
 * Render one section.
 *
 * The default branch returns empty rather than throwing: the manifest already
 * gates which types reach this template, and a build that ships one section
 * short beats a build that fails entirely. The gap surfaces as a validation
 * error at publish, not as a 500 mid-render.
 */
export function renderSection(section: SiteSection, ctx: TemplateContext): string {
  let inner: string;

  switch (section.type) {
    case "prose":    inner = proseInner(section, ctx); break;
    case "stats":    inner = statsInner(section); break;
    case "timeline": inner = timelineInner(section); break;
    case "faq":      inner = faqInner(section); break;
    case "cards":    inner = cardsInner(section, ctx); break;
    default:         return "";
  }

  const bg = section.backgroundImage;
  const backgroundUrl = bg ? ctx.imageUrl(bg) : "";

  return renderPanel({
    // Same slug drives the element id AND the nav href. The original hardcoded
    // ids (#ipo, #offering, #coin) while building hrefs from
    // navLabel.toLowerCase(), so nav links never resolved.
    id: section.slug,
    backgroundUrl,
    focalX: bg?.focalX ?? 0.5,
    focalY: bg?.focalY ?? 0.5,
    overlayOpacity: section.overlayOpacity ?? 0.45,
    backgroundColor: section.backgroundColor,
    align: section.crossAlign ?? "start",
    inner,
  });
}