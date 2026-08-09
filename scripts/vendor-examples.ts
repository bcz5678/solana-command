// ============================================================================
// vendor/ — package definitions
//
// Two worked examples. Each package is a directory containing a
// vendor.config.ts plus whatever it ships.
//
// The config is declarative and lives in the repo, so adding a vendor package
// is a reviewable PR rather than someone running an ad-hoc upload.
// ============================================================================


// ============================================================================
// vendor/fontawesome-brands/vendor.config.ts
//
//   vendor/fontawesome-brands/
//   ├─ vendor.config.ts
//   └─ icons.json          ← from the Font Awesome Free release
//
// No files/ directory. The inline strategy ships nothing: glyphs live in the
// database and the build emits an SVG symbol sprite containing only the icons
// a rendered page actually references.
//
// Four social icons cost roughly 2KB inline. The alternative — fontawesome.css
// plus brands.css plus a webfont — is over 100KB for the same four icons, which
// is what the original index-template.html was doing.
// ============================================================================

import { defineVendorPackage } from "./seed-vendor";

export default defineVendorPackage({
  id: "fontawesome-brands",
  displayName: "Font Awesome Free — Brands",
  kind: "iconset",
  version: "6.5.2",

  // Inline is the point. `copy` is permitted as an escape hatch for a template
  // that genuinely needs the full icon font, but none should.
  allowedStrategies: ["inline", "copy"],

  license: {
    // Font Awesome Free splits three ways: icons CC BY 4.0, fonts SIL OFL 1.1,
    // code MIT. CC BY carries an attribution obligation that matters MORE when
    // extracting individual glyphs than when shipping the vendor's own CSS with
    // its embedded notice — we are stripping the notice.
    //
    // Confirm with counsel before commercial launch.
    spdx: "CC-BY-4.0 AND OFL-1.1 AND MIT",
    requiresAttribution: true,
    attributionText: "Brand icons by Font Awesome Free (CC BY 4.0)",
    noticeUrl: "https://fontawesome.com/license/free",
  },

  icons: {
    source: "icons.json",
    style: "brands",

    // Explicit list, not the whole file. FA Free brands is ~490 icons; storing
    // all of them bloats the registry row for no benefit, since the build only
    // inlines what a page references anyway.
    //
    // Add names here as templates need them, then bump the version.
    include: [
      "x-twitter",
      "telegram",
      "discord",
      "github",
      "youtube",
      "instagram",
      "tiktok",
      "reddit",
      "medium",
    ],
  },
});


// ============================================================================
// vendor/inter/vendor.config.ts
//
//   vendor/inter/
//   ├─ vendor.config.ts
//   └─ files/
//      ├─ inter-latin-400.woff2
//      └─ inter-latin-700.woff2
//
// Self-hosted, replacing the dead `@import url('https://googleapis.com')` in
// the original template. Two reasons beyond it being broken:
//
//   Performance — a third-party font origin costs an extra DNS lookup and TLS
//   handshake on the critical path of a one-page site.
//
//   Legal — German courts have held that loading Google Fonts from Google's CDN
//   transmits visitor IPs without consent in breach of GDPR. On customer
//   domains that is the customer's liability, delivered by our platform.
//
// Subset before landing the files here:
//   pyftsubset Inter-Regular.ttf \
//     --unicodes="U+0000-00FF,U+2000-206F,U+2190-21BB" \
//     --flavor=woff2 --output-file=files/inter-latin-400.woff2
// ============================================================================

/*
import { defineVendorPackage } from "../../scripts/seed-vendor";

export default defineVendorPackage({
  id: "inter",
  displayName: "Inter",
  kind: "font",
  version: "4.0",

  // Fonts must be same-origin or they need CORS headers on every response.
  // `shared` would work via the second-CloudFront-origin route, but that gives
  // up per-site reproducibility for a file this small.
  allowedStrategies: ["copy"],

  license: {
    spdx: "OFL-1.1",
    requiresAttribution: false,
  },

  // Declared, not inferred from filenames. A mis-parsed weight silently ships
  // the wrong face, and nobody notices until a designer squints at a heading.
  faces: [
    { family: "Inter", weight: 400, style: "normal", subset: "latin",
      path: "inter-latin-400.woff2" },
    { family: "Inter", weight: 700, style: "normal", subset: "latin",
      path: "inter-latin-700.woff2" },
  ],

  // The 400 weight is the entry, so it is what gets preloaded when a manifest
  // sets preload: true. Preloading every weight competes with the hero image
  // and usually makes LCP worse.
  entry: "inter-latin-400.woff2",
});
*/


// ============================================================================
// Workflow
// ============================================================================

/*
1. Land the files

     mkdir -p vendor/inter/files
     # subset and convert, then copy the woff2 files in
     $EDITOR vendor/inter/vendor.config.ts

2. Dry run — hashes, entry detection, face validation, no writes

     pnpm tsx scripts/seed-vendor.ts vendor/inter --dry-run

3. Upload and register

     pnpm tsx scripts/seed-vendor.ts vendor/inter

4. Reference it from a template manifest, and BUMP THE MANIFEST VERSION

     dependencies: [
       { packageId: "inter", version: "4.0", strategy: "copy",
         required: true, weights: [400, 700], subsets: ["latin"],
         preload: true },
     ]

5. Sync

     pnpm tsx scripts/sync-manifests.ts

Sites pinned to the previous manifest version are unaffected until someone
rebuilds them against the new one.
*/


// ============================================================================
// Verification in CI
// ============================================================================

/*
Existence check on every PR — fast, catches a manifest referencing a package
nobody uploaded:

    pnpm tsx scripts/seed-vendor.ts vendor/inter --check

Full rehash, nightly or before a release — slower, catches a same-size mutation,
which is exactly what a targeted tamper would look like:

    pnpm tsx scripts/seed-vendor.ts vendor/inter --check --deep

If --deep ever fails, treat it as an incident rather than a bug. The canonical
prefix is immutable by policy; bytes changing under it means either a bad
overwrite or something worse.
*/


// ============================================================================
// Adding an icon to an existing set
// ============================================================================

/*
Icons are stored in the registry row, so adding one is a version bump:

  1. Add the name to `include`
  2. Bump `version` (6.5.2 -> 6.5.3), even though upstream FA did not change —
     the version identifies OUR extracted set, not theirs
  3. Re-run the seeder
  4. Update the manifest's dependency version, bump the manifest version, sync

admin_upsert_vendor_version REFUSES to modify an existing version in place.
Sites pinned to 6.5.2 keep resolving the exact glyph set they published with —
which is the whole point of pinning.
*/