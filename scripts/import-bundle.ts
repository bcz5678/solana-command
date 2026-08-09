// ============================================================================
// scripts/import-bundle.ts
//
// Imports a published site bundle into a slotted template.
//
//   pnpm tsx scripts/import-bundle.ts templates/neon-launch --version 1.0.0
//   pnpm tsx scripts/import-bundle.ts templates/neon-launch --check
//   pnpm tsx scripts/import-bundle.ts templates/neon-launch --version 1.0.0 --no-upload
//
// Expects:
//   templates/{id}/
//   ├─ source.html
//   └─ assets/            (css, js, img, fonts — any structure)
//
// Produces:
//   ├─ bundle.generated.ts    source string, hash, and bundleAssets array
//   ├─ index.ts               registration barrel (only if absent)
//   ├─ manifest.ts            scaffold (only if absent)
//   └─ IMPORT_REPORT.md       what the sanitizer stripped — REVIEW THIS
//
// ...and uploads every asset to s3://{bucket}/_templates/{id}@{version}/.
//
// Why a generated .ts rather than importing source.html directly: `?raw`
// imports are bundler-specific and unreliable under Turbopack. A generated
// module works everywhere and keeps the render path free of filesystem reads,
// which is what lets the form's live preview run the identical code.
// ============================================================================

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname, basename } from "node:path";
import { createHash } from "node:crypto";
import { parseHTML } from "linkedom";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { sanitizeDocument, formatReport, SanitizePolicySchema } from "@site/renderer";

// ============================================================================
// ARGS
// ============================================================================

const args = process.argv.slice(2);
const bundleDir = args[0];

if (!bundleDir) {
  console.error("Usage: import-bundle.ts <bundle-dir> [--version X.Y.Z] [--check] [--no-upload]");
  process.exit(1);
}

const CHECK_ONLY = args.includes("--check");
const NO_UPLOAD = args.includes("--no-upload");
const version = argValue("--version") ?? "1.0.0";
const templateId = basename(bundleDir);
const templateKey = `${templateId}@${version}`;

function argValue(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

// ============================================================================
// CONTENT TYPES
// ============================================================================

/**
 * Extension -> Content-Type. Emitted on the S3 object AND stored in the
 * manifest, because CopyObject with MetadataDirective: REPLACE needs it — the
 * build sets these explicitly rather than inheriting from the source object.
 */
const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".json": "application/json",
};

/**
 * Never uploaded. Source maps leak original sources; .DS_Store and friends are
 * noise; .html other than source.html would be a second page this template
 * cannot render anyway.
 */
const SKIP = new Set([".map", ".ds_store", ".gitkeep", ".md", ".txt", ".html", ".htm"]);

// ============================================================================
// WALK
// ============================================================================

interface BundleFile {
  /** Path relative to the bundle dir, as referenced in source.html. */
  path: string;
  absolutePath: string;
  integrity: string;
  contentType: string;
  bytes: number;
}

function walkAssets(root: string): BundleFile[] {
  const assetsDir = join(root, "assets");

  if (!existsSync(assetsDir)) {
    console.warn("  ! No assets/ directory found — bundle has no static files");
    return [];
  }

  const files: BundleFile[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const absolute = join(dir, entry);

      if (statSync(absolute).isDirectory()) {
        walk(absolute);
        continue;
      }

      const ext = extname(entry).toLowerCase();
      if (SKIP.has(ext) || entry.startsWith(".")) continue;

      const bytes = readFileSync(absolute);

      files.push({
        // Forward slashes regardless of platform — these become URLs.
        path: relative(root, absolute).split("\\").join("/"),
        absolutePath: absolute,
        // sha384 SRI. Verified by admin_upsert_vendor_version's equivalent
        // check, and by the build before anything is copied.
        integrity: `sha384-${createHash("sha384").update(bytes).digest("base64")}`,
        contentType: CONTENT_TYPES[ext] ?? "application/octet-stream",
        bytes: bytes.length,
      });
    }
  }

  walk(assetsDir);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

// ============================================================================
// UNMAPPED REFERENCE SCAN
// ============================================================================

/**
 * Local references in the source with no corresponding bundle file.
 *
 * These 404 on the live site. Catching them here beats discovering a missing
 * stylesheet after a customer's domain is serving an unstyled page.
 */
function findUnmapped(html: string, files: BundleFile[]): string[] {
  const known = new Set<string>();
  for (const f of files) {
    known.add(f.path);
    known.add(`./${f.path}`);
    known.add(`/${f.path}`);
  }

  const missing = new Set<string>();
  const patterns = [
    /(?:href|src|poster)\s*=\s*["']([^"']+)["']/gi,
    /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi,
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const raw = match[1]!;
      // Skip absolute, protocol-relative, data, and fragment references.
      if (/^(https?:|data:|mailto:|tel:|#|\/\/)/i.test(raw)) continue;
      if (!known.has(raw)) missing.add(raw);
    }
  }

  return [...missing].sort();
}

// ============================================================================
// CODE GENERATION
// ============================================================================

/**
 * Escape HTML for embedding in a template literal.
 *
 * Backticks, backslashes and `${` all need escaping or the generated module is
 * a syntax error — and `${` in particular would silently execute whatever
 * followed as an expression.
 */
function escapeForTemplateLiteral(html: string): string {
  return html
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");
}

function generateBundleModule(
  html: string,
  sourceHash: string,
  files: BundleFile[],
): string {
  const assets = files
    .map(
      (f) =>
        `  {\n` +
        `    path: ${JSON.stringify(f.path)},\n` +
        `    integrity: ${JSON.stringify(f.integrity)},\n` +
        `    contentType: ${JSON.stringify(f.contentType)},\n` +
        `    rewriteInternalUrls: ${f.contentType.startsWith("text/css")},\n` +
        `  },`,
    )
    .join("\n");

  return `// ============================================================================
// GENERATED BY scripts/import-bundle.ts — DO NOT EDIT
//
// Template: ${templateKey}
// Source hash: ${sourceHash}
// Assets: ${files.length} file(s), ${(files.reduce((n, f) => n + f.bytes, 0) / 1024).toFixed(1)} KB
//
// Re-generate after replacing source.html or anything under assets/:
//   pnpm tsx scripts/import-bundle.ts ${bundleDir} --version ${version}
//
// Editing this file by hand will be silently overwritten, and SOURCE_HASH will
// no longer match the bytes the renderer checks against.
// ============================================================================

import type { BundleAsset } from "@site/schema";

/** sha256 of SOURCE_HTML. renderSlotted refuses to render on a mismatch. */
export const SOURCE_HASH = ${JSON.stringify(sourceHash)};

/**
 * Static files shipping with this bundle. Uploaded to
 * _templates/${templateKey}/ and copied into each site's prefix at build time.
 */
export const BUNDLE_ASSETS: BundleAsset[] = [
${assets}
];

/** The imported document, verbatim. Sanitized at render time, not here. */
export const SOURCE_HTML = \`${escapeForTemplateLiteral(html)}\`;
`;
}

function generateIndexModule(): string {
  return `// ============================================================================
// src/site-platform/renderer/templates/${templateId}/index.ts
//
// Registration barrel for a SLOTTED template.
//
// Unlike a tokenized template there is no render function — the imported source
// IS the document, and the mapping in manifest.ts describes what gets swapped.
// ============================================================================

import { registerSlottedTemplate } from "../../slotted/index.js";
import { SOURCE_HTML } from "./bundle.generated.js";
import { ${camel(templateId)}Manifest } from "./manifest.js";

registerSlottedTemplate(${JSON.stringify(templateKey)}, SOURCE_HTML);

export { ${camel(templateId)}Manifest };
`;
}

function generateManifestScaffold(): string {

  const previewImage = `/template-previews/${templateId}.png`; 
  
  return `// ============================================================================
// src/site-platform/renderer/templates/${templateId}/manifest.ts
//
// SCAFFOLD — the slots and repeaters below are placeholders. Filling them in is
// the actual import work; see TEMPLATE_RUNBOOK.md, "Step 3 — Write selectors".
//
// Open source.html in a browser with devtools and copy a selector for each
// editable region. Prefer ids and BEM-style classes over structural selectors:
// \`.hero > div:nth-child(2) > p\` breaks when the bundle is updated,
// \`.hero__sub\` survives.
// ============================================================================

import { TemplateManifestSchema, type TemplateManifest } from "@site/schema";
import { SOURCE_HASH, BUNDLE_ASSETS } from "./bundle.generated.js";

export const ${camel(templateId)}Manifest: TemplateManifest = TemplateManifestSchema.parse({
  id: ${JSON.stringify(templateId)},
  name: ${JSON.stringify(titleCase(templateId))},
  description: "Imported bundle. TODO: describe the look.",
  version: ${JSON.stringify(version)},
  previewImage: ${JSON.stringify(previewImage)},

  kind: "slotted",

  // Not used by slotted templates — no render function to dispatch to — but
  // required by the schema. Keep it consistent with the registered sourceKey.
  rendererKey: ${JSON.stringify(templateKey)},

  flow: "vertical",

  // A slotted template can only render what its repeaters cover. Set these to
  // match reality, or the form offers sections the build silently drops.
  supportedSectionTypes: [],
  sectionCount: { min: 0, max: 0 },
  supportsModules: [],

  // Paths the source cannot render without. Test each by deleting the field
  // from a fixture and confirming publish is blocked.
  requiredContent: ["meta.fqdn", "meta.title", "brand.name", "hero.title"],

  dependencies: [],

  imageAspect: { hero: "16/9", section: "16/9", card: "4/3", gallery: "1/1" },

  // MUST be empty — the schema enforces it. A slotted template's look comes
  // from the imported stylesheet, so theme controls would change nothing.
  usesThemeKeys: [],

  slotted: {
    sourceKey: ${JSON.stringify(templateKey)},
    sourceHash: SOURCE_HASH,
    bundleAssets: BUNDLE_ASSETS,

    slots: [
      // { selector: "h1.hero__title", path: "hero.title" },
      // { selector: ".hero", path: "hero.backgroundImage", mode: "bgImage", imageSlot: "hero" },
      // { selector: "a.hero__cta", path: "hero.ctas[0]", mode: "link" },
      // { selector: "#contract-value", path: "modules.token.contractAddress" },
      // { selector: ".social-row", path: "social", mode: "removeIfEmpty" },
    ],

    repeaters: [
      // {
      //   selector: ".features .card",
      //   path: "sections[0].cards",
      //   containerSelector: ".features",
      //   slots: [
      //     { selector: "h3", path: "title" },
      //     { selector: "p", path: "body" },
      //   ],
      // },
    ],

    sanitize: {
      // Source scripts are stripped unconditionally. Re-add only what a
      // reviewer read, from IMPORT_REPORT.md.
      approvedScripts: [],
      allowedOrigins: [],
      allowIframes: false,
      allowForms: false,
      // The source's cookie banner, its own analytics container, a badge.
      stripSelectors: [],
    },

    // Rewrites in-page anchors to generated section slugs, matched BY ORDER.
    // Leave off unless the source's nav order matches its section order.
    rewriteAnchors: false,
  },
});
`;
}

function camel(input: string): string {
  return input.replace(/[-_](.)/g, (_, c: string) => c.toUpperCase());
}

function titleCase(input: string): string {
  return input.split(/[-_]/).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");
}

// ============================================================================
// UPLOAD
// ============================================================================

async function upload(files: BundleFile[]): Promise<void> {
  const client = new S3Client({ region: requireEnv("AWS_REGION") });
  const bucket = requireEnv("SITES_BUCKET");

  for (const file of files) {
    const key = `_templates/${templateKey}/${file.path}`;

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: readFileSync(file.absolutePath),
        ContentType: file.contentType,
        // The canonical copy is immutable: the template version is in the key,
        // so a new import writes to a new prefix rather than overwriting.
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );

    console.log(`    ↑ ${key} (${(file.bytes / 1024).toFixed(1)} KB)`);
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log(`\nImporting ${templateKey}${CHECK_ONLY ? " (check only)" : ""}\n`);

  const sourcePath = join(bundleDir, "source.html");
  if (!existsSync(sourcePath)) {
    console.error(`  ✗ No source.html in ${bundleDir}`);
    process.exit(1);
  }

  const html = readFileSync(sourcePath, "utf8");
  const sourceHash = createHash("sha256").update(html).digest("hex");

  console.log(`  source.html — ${(html.length / 1024).toFixed(1)} KB, sha256 ${sourceHash.slice(0, 12)}…`);

  // ---- Assets ----
  const files = walkAssets(bundleDir);
  console.log(`  assets — ${files.length} file(s)\n`);

  // ---- Unmapped references ----
  const unmapped = findUnmapped(html, files);
  if (unmapped.length > 0) {
    console.warn(`  ! ${unmapped.length} local reference(s) with no bundle file:`);
    for (const ref of unmapped.slice(0, 20)) console.warn(`      ${ref}`);
    if (unmapped.length > 20) console.warn(`      …and ${unmapped.length - 20} more`);
    console.warn(`    These will 404 on the live site.\n`);
  }

  // ---- Sanitize dry run ----
  // Run against a throwaway parse purely to produce the report. The real
  // sanitization happens at render time, every time.
  const { document } = parseHTML(html);
  const report = sanitizeDocument(document as never, {
    policy: SanitizePolicySchema.parse({}),
    knownAssets: new Set(files.map((f) => f.path)),
  });

  for (const ref of unmapped) {
    report.warnings.push(`Unmapped local reference: ${ref}`);
  }

  console.log(`  Sanitizer:`);
  console.log(`    scripts removed        ${report.scripts.length}`);
  console.log(`    event handlers removed ${report.eventHandlers.length}`);
  console.log(`    external origins       ${report.externalOrigins.length}`);
  console.log(`    elements removed       ${report.elements.length}`);
  console.log(`    warnings               ${report.warnings.length}\n`);

  if (report.scripts.length > 0) {
    console.log(`    Every removed script is code the bundle intended to run.`);
    console.log(`    Read IMPORT_REPORT.md before approving any of them.\n`);
  }

  // ---- Check mode ----
  if (CHECK_ONLY) {
    const generatedPath = join(bundleDir, "bundle.generated.ts");

    if (!existsSync(generatedPath)) {
      console.error(`  ✗ bundle.generated.ts missing — run without --check`);
      process.exit(1);
    }

    const existing = readFileSync(generatedPath, "utf8");

    if (!existing.includes(sourceHash)) {
      console.error(
        `  ✗ bundle.generated.ts is stale — source.html changed since it was generated.\n` +
        `    Re-run the importer and bump the template version.`,
      );
      process.exit(1);
    }

    for (const file of files) {
      if (!existing.includes(file.integrity)) {
        console.error(`  ✗ Asset changed since generation: ${file.path}`);
        process.exit(1);
      }
    }

    console.log("  = In sync.\n");
    return;
  }

  // ---- Write ----
  writeFileSync(join(bundleDir, "bundle.generated.ts"), generateBundleModule(html, sourceHash, files));
  console.log(`  + bundle.generated.ts`);

  writeFileSync(join(bundleDir, "IMPORT_REPORT.md"), formatReport(report, templateKey));
  console.log(`  + IMPORT_REPORT.md`);

  // Scaffolds only — never overwrite hand-written mapping work.
  const manifestPath = join(bundleDir, "manifest.ts");
  if (!existsSync(manifestPath)) {
    writeFileSync(manifestPath, generateManifestScaffold());
    console.log(`  + manifest.ts (scaffold)`);
  } else {
    console.log(`  = manifest.ts (kept)`);
  }

  const indexPath = join(bundleDir, "index.ts");
  if (!existsSync(indexPath)) {
    writeFileSync(indexPath, generateIndexModule());
    console.log(`  + index.ts`);
  } else {
    console.log(`  = index.ts (kept)`);
  }

  // ---- Upload ----
  if (NO_UPLOAD) {
    console.log(`\n  (skipped upload)\n`);
  } else if (files.length > 0) {
    console.log(`\n  Uploading to _templates/${templateKey}/`);
    await upload(files);
    console.log("");
  }

  // ---- Next steps ----
  console.log(`Next:
  1. Read ${bundleDir}/IMPORT_REPORT.md — review every stripped script
  2. Fill in slots and repeaters in ${bundleDir}/manifest.ts
  3. Add to templates/index.ts:  import "./${templateId}/index.js";
  4. pnpm vitest run
  5. pnpm tsx scripts/sync-manifests.ts
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});