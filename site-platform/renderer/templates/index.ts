// ============================================================================
// packages/site-renderer/src/templates/index.ts
//
// Registration barrel. Imported for side effects by src/index.ts.
//
// Adding a template is:
//   1. a directory here with a render function
//   2. one registerTemplate() line below
//   3. one row in private.template_versions with a matching renderer_key
//
// Nothing in the form, the API routes, the SQL, or n8n changes.
//
// The key format is `{template-id}@{major}`. It is the value stored in
// template_versions.renderer_key, so a breaking change to a template's render
// function bumps the major here and old published sites keep resolving to the
// old function — which is what makes version pinning actually reproducible
// rather than aspirational.
// ============================================================================

import { registerTemplate } from "../render.js";
import { renderHeroOnepager } from "./hero-onepager/index.js";

registerTemplate("hero-onepager@1", renderHeroOnepager);

// Next up — the side scroller. Registers the same way; the horizontal flow is
// declared in its manifest, not detected here:
//
//   import { renderSideScroller } from "./side-scroller/index.js";
//   registerTemplate("side-scroller@1", renderSideScroller);

export { renderHeroOnepager };