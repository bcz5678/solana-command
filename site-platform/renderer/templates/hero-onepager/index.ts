// ============================================================================
// packages/site-renderer/src/templates/hero-onepager/index.ts
//
// Port of index-template.html.
//
// Fixes carried over from the audit, in the order they appeared:
//   • nav hrefs and section ids now derive from the SAME slug (they never
//     matched before, so no anchor resolved)
//   • social links use real hrefs, not "#" + url, with target/rel and labels
//   • no trailing space inside href attributes
//   • .btn:hover now differs from .btn
//   • the unclosed .content div is closed
//   • the dead @import url('https://googleapis.com') is gone; fonts arrive as
//     a declared vendor dependency and are self-hosted
//   • copy-to-clipboard is a <button> with a hashed inline script, not an
//     onclick attribute on an <a> containing block elements
//   • <script> moved inside <body> (it sat after </html>)
//   • og:image alt is a meta property, not an attribute (in document.ts)
//   • the duplicated * reset is gone (single reset in @layer reset)
//   • all hardcoded colours replaced with tokens
//   • fdqn -> fqdn
//   • scroll-margin for the fixed header
//   • copyright year computed at build time
//   • sections loop instead of div1/div2/div3
// ============================================================================

import type { TemplateContext, TemplateOutput } from "../../types";
import { esc, escAttr, safeUrl, attrs } from "../../escape";
import { heroOnepagerStyles } from "./styles";
import {
  renderPanel,
  renderKicker,
  renderBody,
  renderCtaRow,
  renderSection,
} from "./sections";

// ============================================================================
// ICONS
// ============================================================================

/**
 * Reference into the inline SVG sprite that the vendor resolver injects.
 *
 * The href pattern is what detectIcons() scans for, so only the glyphs actually
 * referenced here get inlined — four social icons at ~2KB instead of the
 * original's two Font Awesome stylesheets plus a webfont.
 *
 * currentColor is why the original's per-instance style="color: ..." is gone.
 */
function icon(platform: string, label: string): string {
  return `<svg role="img" aria-label="${escAttr(label)}"><use href="#i-${escAttr(platform)}"/></svg>`;
}

function socialLink(link: { platform: string; label: string; url: string }): string {
  return `<a href="${safeUrl(link.url)}" target="_blank" rel="noopener noreferrer">${icon(link.platform, link.label)}</a>`;
}

// ============================================================================
// HEADER
// ============================================================================

function renderHeader(ctx: TemplateContext): string {
  const { content } = ctx.definition;

  const navItems = ctx.sections
    .filter((s) => s.showInNav)
    .map(
      (s) => `<li><a href="#${escAttr(s.slug)}">${esc(s.navLabel)}</a></li>`,
    )
    .join("\n            ");

  const navSocial = content.social
    .filter((s) => s.showInNav)
    .map(socialLink)
    .join("\n          ");

  // aria-controls / aria-expanded were absent entirely; the toggle announced
  // nothing about the menu's state.
  return `
  <header class="site-header">
    <a class="logo" href="#top">${esc(content.brand.logoText ?? content.brand.name)}</a>

    <nav class="nav" aria-label="Primary">
      ${navSocial ? `<div class="nav-social">\n          ${navSocial}\n        </div>` : ""}

      <ul class="nav-links" id="nav-links" data-open="false">
        ${navItems}
      </ul>

      <button
        class="menu-toggle"
        type="button"
        aria-label="Toggle navigation"
        aria-controls="nav-links"
        aria-expanded="false"
        data-menu-toggle
      >
        <span class="bar"></span>
        <span class="bar"></span>
        <span class="bar"></span>
      </button>
    </nav>
  </header>`;
}

// ============================================================================
// CONTRACT ADDRESS MODULE
// ============================================================================

/**
 * Was an <a> with no href wrapping an <h3> and two <div>s, fired by
 * onclick="copyText()". Not focusable, not keyboard-operable, invalid nesting,
 * and it forced 'unsafe-inline' into the CSP — on the one element whose entire
 * purpose is handing the visitor a string worth stealing.
 */
function renderContract(ctx: TemplateContext): string {
  const token = ctx.definition.content.modules?.token;
  if (!token?.contractAddress) return "";

  return `
        <button class="contract" type="button"
                data-copy="${escAttr(token.contractAddress)}"
                data-copy-confirm="${escAttr(token.copyConfirmation ?? "Copied to clipboard")}">
          <span class="contract-label">${esc(token.copyLabel ?? "Contract address — click to copy")}</span>
          <span class="contract-value">${esc(token.contractAddress)}</span>
          <span class="contract-status" data-copy-status role="status" aria-live="polite"></span>
        </button>`;
}

// ============================================================================
// HERO
// ============================================================================

function renderHero(ctx: TemplateContext): string {
  const { hero, social } = ctx.definition.content;
  const bg = hero.backgroundImage;
  const backgroundUrl = bg ? ctx.imageUrl(bg) : "";

  const heroSocial = social.filter((s) => s.showInHero);

  const socialRow = heroSocial.length
    ? `
        <div class="hero-social">
          <span>Join us</span>
          ${heroSocial.map(socialLink).join("\n          ")}
        </div>`
    : "";

  const inner = [
    renderKicker(hero.kicker),
    `<h1>${esc(hero.title)}</h1>`,
    renderBody(hero.body),
    renderCtaRow(hero.ctas),
    renderContract(ctx),
    socialRow,
  ].filter(Boolean).join("\n        ");

  return renderPanel({
    id: "top",
    extraClass: "hero",
    backgroundUrl,
    focalX: bg?.focalX ?? 0.5,
    focalY: bg?.focalY ?? 0.5,
    overlayOpacity: hero.overlayOpacity ?? 0.45,
    align: hero.crossAlign ?? "start",
    inner,
  });
}

// ============================================================================
// FOOTER
// ============================================================================

function renderFooter(ctx: TemplateContext): string {
  const { footer } = ctx.definition.content;

  const links = footer.links?.length
    ? `
    <ul class="footer-links">
      ${footer.links
        .map((l) => `<li><a href="${safeUrl(l.href)}">${esc(l.label)}</a></li>`)
        .join("\n      ")}
    </ul>`
    : "";

  // The original hardcoded the entire disclaimer as prose in the template, so
  // every generated site carried identical legal text regardless of what it
  // was actually selling.
  const disclaimer = footer.disclaimer
    ? `<p>${esc(footer.disclaimer)}</p>`
    : "";

  const legal = footer.legal;
  const legalLine = legal?.coinName || legal?.companyName
    ? `<p>&copy;${ctx.year} ${esc(legal.coinName ?? "")}${
        legal.companyName ? ` — not affiliated with ${esc(legal.companyName)}` : ""
      }</p>`
    : `<p>&copy;${ctx.year} ${esc(ctx.definition.content.brand.name)}</p>`;

  // CC BY obligations from the resolved vendor set. Discharged here rather than
  // left to the author to remember.
  const attribution = ctx.attributions.length
    ? `<p class="footer-attribution">${ctx.attributions.map(esc).join(" · ")}</p>`
    : "";

  return `
  <footer class="site-footer">${links}
    ${disclaimer}
    ${legalLine}
    ${attribution}
  </footer>`;
}

// ============================================================================
// SCRIPTS
// ============================================================================

/**
 * Single inline script, hashed for the CSP by assembleDocument().
 *
 * Event delegation over data attributes, so no element carries an inline
 * handler and script-src stays 'self' plus this exact hash. Note the text is
 * hashed byte-for-byte — reformatting it after assembly invalidates the hash
 * and the browser will refuse to run it.
 */
function behaviourScript(): string {
  return `
(function () {
  "use strict";

  // ---- Mobile menu ----
  var toggle = document.querySelector("[data-menu-toggle]");
  var links  = document.getElementById("nav-links");

  if (toggle && links) {
    toggle.addEventListener("click", function () {
      var open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      links.setAttribute("data-open", String(!open));
    });

    // Close on navigation, or the menu covers the section just jumped to.
    links.addEventListener("click", function (e) {
      if (e.target.tagName === "A") {
        toggle.setAttribute("aria-expanded", "false");
        links.setAttribute("data-open", "false");
      }
    });

    // Escape closes and returns focus to the control.
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
        toggle.setAttribute("aria-expanded", "false");
        links.setAttribute("data-open", "false");
        toggle.focus();
      }
    });
  }

  // ---- Copy to clipboard ----
  // The original used alert(), which blocks the page and looks like malware on
  // a crypto site. Inline status text in an aria-live region instead.
  document.querySelectorAll("[data-copy]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var value  = btn.getAttribute("data-copy");
      var status = btn.querySelector("[data-copy-status]");

      function done(message) {
        if (!status) return;
        status.textContent = message;
        setTimeout(function () { status.textContent = ""; }, 2500);
      }

      // Clipboard API needs a secure context. Published sites are HTTPS, but
      // a local file:// preview is not — hence the fallback.
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(value).then(
          function () { done(btn.getAttribute("data-copy-confirm")); },
          function () { done("Copy failed — select and copy manually"); }
        );
      } else {
        var field = document.createElement("textarea");
        field.value = value;
        field.setAttribute("readonly", "");
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.appendChild(field);
        field.select();
        try {
          document.execCommand("copy");
          done(btn.getAttribute("data-copy-confirm"));
        } catch (err) {
          done("Copy failed — select and copy manually");
        }
        document.body.removeChild(field);
      }
    });
  });

  // ---- Header height ----
  // Feeds --st-header-h, which drives scroll-padding so anchor jumps do not
  // land underneath the fixed header. Measured rather than assumed, because
  // the header's height depends on the theme's font size and padding.
  var header = document.querySelector(".site-header");
  if (header) {
    var setHeight = function () {
      document.documentElement.style.setProperty(
        "--st-header-h", header.offsetHeight + "px"
      );
    };
    setHeight();
    window.addEventListener("resize", setHeight, { passive: true });
  }
})();
`.trim();
}

// ============================================================================
// RENDERER
// ============================================================================

export function renderHeroOnepager(ctx: TemplateContext): TemplateOutput {
  const sections = ctx.sections
    .map((section) => renderSection(section, ctx))
    .filter(Boolean)
    .join("\n");

  const body = `
  <a class="skip-link" href="#main">Skip to content</a>
${renderHeader(ctx)}

  <main id="main">
${renderHero(ctx)}
${sections}
  </main>
${renderFooter(ctx)}`;

  return {
    body,
    css: heroOnepagerStyles(ctx.theme),
    inlineScripts: [behaviourScript()],
  };
}