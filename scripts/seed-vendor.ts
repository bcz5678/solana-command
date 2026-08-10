// ============================================================================
// scripts/seed-vendor.ts
//
// Uploads a vendor package to _vendor/{id}@{version}/ and registers it.
//
//   pnpm tsx scripts/seed-vendor.ts vendor/inter
//   pnpm tsx scripts/seed-vendor.ts vendor/fontawesome-brands
//   pnpm tsx scripts/seed-vendor.ts vendor/inter --check
//   pnpm tsx scripts/seed-vendor.ts vendor/inter --check --deep
//   pnpm tsx scripts/seed-vendor.ts vendor/inter --dry-run
//
// Deploy-time, never build-time. Three reasons the build must not upload:
//
//   1. INTEGRITY  — SRI hashes are computed and verified here. A build that
//                   uploaded on demand would trust whatever it found on disk.
//   2. IMMUTABILITY — _vendor/inter@4.0/ must hold identical bytes forever.
//                   Auto-upload lets a build overwrite it, and every site
//                   pinned to 4.0 silently changes on its next rebuild.
//   3. PURITY     — resolveDependency has no filesystem or network access. It
//                   emits copy instructions; it cannot discover a missing file.
//
// Layout expected:
//   vendor/{id}/
//   ├─ vendor.config.ts     declarative definition, reviewed in the PR
//   ├─ files/               everything uploaded (absent for inline iconsets)
//   └─ icons.json           iconset source, for glyph extraction
// ============================================================================

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand }
  from "@aws-sdk/client-s3";

// ============================================================================
// CONFIG SHAPE
// ============================================================================

export type VendorKind = "stylesheet" | "script" | "font" | "iconset" | "polyfill";
export type VendorStrategy = "inline" | "copy" | "shared" | "external";

export interface VendorConfig {
  id: string;
  displayName: string;
  kind: VendorKind;
  version: string;

  /** Strategies a template may request. Enforced again in resolveDependency. */
  allowedStrategies: VendorStrategy[];

  license: {
    spdx: string;
    requiresAttribution: boolean;
    /** Rendered in the generated site's footer when required. */
    attributionText?: string;
    noticeUrl?: string;
  };

  /**
   * Iconset glyph extraction. Reads a Font Awesome style icons.json and pulls
   * viewBox + path for the named icons, so the build can inline a subset
   * instead of shipping a stylesheet and a webfont.
   */
  icons?: {
    source: string;             // path to icons.json, relative to the package dir
    /** Specific names, or omit for every icon in the file (rarely what you want). */
    include?: string[];
    /** FA nests under svg.brands / svg.solid / svg.regular. */
    style?: "brands" | "solid" | "regular";
  };

  /**
   * Font faces. Paths are relative to files/. Declared rather than inferred
   * from filenames — a mis-parsed weight silently ships the wrong face.
   */
  faces?: Array<{
    family: string;
    weight: number;
    style: "normal" | "italic";
    subset: string;
    path: string;
  }>;

  /** Marks the entry point when it is not the first file alphabetically. */
  entry?: string;
}

/** Identity helper, purely for the type inference in vendor.config.ts. */
export function defineVendorPackage(config: VendorConfig): VendorConfig {
  return config;
}

// ============================================================================
// ARGS
// ============================================================================

const args = process.argv.slice(2);
const packageDir = args[0];

if (!packageDir) {
  console.error("Usage: seed-vendor.ts <package-dir> [--check] [--deep] [--dry-run]");
  process.exit(1);
}

const CHECK = args.includes("--check");
const DEEP = args.includes("--deep");
const DRY_RUN = args.includes("--dry-run");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

// ============================================================================
// CONTENT TYPES
// ============================================================================

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

/** Never uploaded: source maps leak originals, and the config is not an asset. */
const SKIP_EXT = new Set([".map", ".ts", ".md", ".txt"]);

// ============================================================================
// FILES
// ============================================================================

interface VendorFile {
  path: string;
  absolutePath: string;
  integrity: string;
  contentType: string;
  bytes: number;
  entry: boolean;
}

function collectFiles(dir: string, config: VendorConfig): VendorFile[] {
  const filesDir = join(dir, "files");

  if (!existsSync(filesDir)) {
    // Normal for an inline iconset: glyphs live in the database, nothing ships.
    return [];
  }

  const found: VendorFile[] = [];

  function walk(current: string): void {
    for (const entry of readdirSync(current)) {
      const absolute = join(current, entry);

      if (statSync(absolute).isDirectory()) {
        walk(absolute);
        continue;
      }

      const ext = extname(entry).toLowerCase();
      if (SKIP_EXT.has(ext) || entry.startsWith(".")) continue;

      const bytes = readFileSync(absolute);
      const path = relative(filesDir, absolute).split("\\").join("/");

      found.push({
        path,
        absolutePath: absolute,
        // sha384 SRI. Computed here and stored in the registry; the build's
        // hashedName() derives the published filename from it, so a changed
        // file produces a changed filename and can never be served stale.
        integrity: `sha384-${createHash("sha384").update(bytes).digest("base64")}`,
        contentType: CONTENT_TYPES[ext] ?? "application/octet-stream",
        bytes: bytes.length,
        entry: false,
      });
    }
  }

  walk(filesDir);
  found.sort((a, b) => a.path.localeCompare(b.path));

  // Entry point. Explicit config wins; otherwise the first stylesheet or
  // script, since that is what a <link> or <script> tag points at.
  const entryPath = config.entry
    ?? found.find((f) => f.contentType.startsWith("text/"))?.path
    ?? found[0]?.path;

  for (const file of found) {
    if (file.path === entryPath) file.entry = true;
  }

  return found;
}

// ============================================================================
// GLYPH EXTRACTION
// ============================================================================

/**
 * Pull viewBox and path data out of a Font Awesome style icons.json.
 *
 * FA's shape:
 *   { "telegram": { "svg": { "brands": { "viewBox": [0,0,496,512], "path": "M248 8C111..." } } } }
 *
 * Extracting glyphs is what lets a template inline four social icons at ~2KB
 * instead of loading two stylesheets and a webfont for the same four icons.
 */
function extractGlyphs(
  dir: string,
  config: NonNullable<VendorConfig["icons"]>,
): Record<string, { viewBox: string; path: string }> {
  const sourcePath = join(dir, config.source);

  if (!existsSync(sourcePath)) {
    throw new Error(`Icon source not found: ${sourcePath}`);
  }

  const raw = JSON.parse(readFileSync(sourcePath, "utf8")) as Record<string, unknown>;
  const style = config.style ?? "brands";
  const names = config.include ?? Object.keys(raw);

  const glyphs: Record<string, { viewBox: string; path: string }> = {};
  const missing: string[] = [];

  for (const name of names) {
    const entry = raw[name] as
      | { svg?: Record<string, { viewBox?: number[]; path?: string }> }
      | undefined;

    const svg = entry?.svg?.[style];

    if (!svg?.path || !svg.viewBox) {
      missing.push(name);
      continue;
    }

    glyphs[name] = {
      viewBox: svg.viewBox.join(" "),
      path: svg.path,
    };
  }

  if (missing.length > 0) {
    // Loud, not silent. A manifest declaring an icon that was never extracted
    // renders an empty <use> reference — an invisible social link.
    throw new Error(
      `Icons not found in ${config.source} under style "${style}": ${missing.join(", ")}`,
    );
  }

  return glyphs;
}

// ============================================================================
// CLIENTS
// ============================================================================

let s3: S3Client | null = null;
function s3Client(): S3Client {
  s3 ??= new S3Client({ region: requireEnv("AWS_REGION") });
  return s3;
}

/**
 * Authenticates as a super admin, not with the service key.
 *
 * admin_upsert_vendor_version gates on private.is_super_admin_db(), which reads
 * auth.uid(). A service_role client has no auth.uid(), so the gate fails closed
 * — and using service_role would hand CI a far wider credential than one
 * admin's session.
 */
async function adminSession() {
  const supabase = createClient(
    // Same pair the app's RLS-scoped clients read (lib/supabase/server.ts et
    // al.) — this is a real user session via signInWithPassword below, not a
    // service credential, so it belongs with the anon/publishable pair.
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    { auth: { persistSession: false } },
  );

  const { error } = await supabase.auth.signInWithPassword({
    email: requireEnv("ADMIN_EMAIL"),
    password: requireEnv("ADMIN_PASSWORD"),
  });

  if (error) throw new Error(`admin sign-in failed: ${error.message}`);
  return supabase;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const dir = resolve(packageDir);
  const configPath = join(dir, "vendor.config.ts");

  if (!existsSync(configPath)) {
    console.error(`  ✗ No vendor.config.ts in ${packageDir}`);
    process.exit(1);
  }

  const config: VendorConfig = (await import(configPath)).default;
  const prefix = `_vendor/${config.id}@${config.version}`;

  console.log(`\n${config.id}@${config.version} — ${config.kind}`);
  console.log(`  license: ${config.license.spdx}${config.license.requiresAttribution ? " (attribution required)" : ""}`);
  console.log(`  strategies: ${config.allowedStrategies.join(", ")}\n`);

  // ---- Files ----
  const files = collectFiles(dir, config);

  if (files.length === 0) {
    if (!config.allowedStrategies.includes("inline")) {
      console.error(
        `  ✗ No files under files/, but "inline" is not an allowed strategy.\n` +
        `    A copy/shared/external package with nothing to serve cannot work.`,
      );
      process.exit(1);
    }
    console.log(`  files: none (inline only — glyphs live in the database)`);
  } else {
    console.log(`  files: ${files.length}`);
    for (const f of files) {
      console.log(`    ${f.entry ? "→" : " "} ${f.path}  ${(f.bytes / 1024).toFixed(1)} KB`);
    }
  }

  // ---- Glyphs ----
  let glyphs: Record<string, { viewBox: string; path: string }> | null = null;

  if (config.icons) {
    glyphs = extractGlyphs(dir, config.icons);
    console.log(`  glyphs: ${Object.keys(glyphs).length} (${Object.keys(glyphs).slice(0, 6).join(", ")}${Object.keys(glyphs).length > 6 ? "…" : ""})`);
  }

  // ---- Faces ----
  if (config.faces) {
    const known = new Set(files.map((f) => f.path));
    const orphans = config.faces.filter((f) => !known.has(f.path));

    if (orphans.length > 0) {
      console.error(
        `  ✗ Declared faces with no matching file: ${orphans.map((f) => f.path).join(", ")}`,
      );
      process.exit(1);
    }
    console.log(`  faces: ${config.faces.length}`);
  }

  const bucket = requireEnv("SITES_BUCKET");

  // ---- Check mode ----
  if (CHECK) {
    console.log(`\n  Verifying s3://${bucket}/${prefix}/\n`);
    let problems = 0;

    for (const file of files) {
      const key = `${prefix}/${file.path}`;

      try {
        const head = await s3Client().send(
          new HeadObjectCommand({ Bucket: bucket, Key: key }),
        );

        if (head.ContentLength !== file.bytes) {
          console.error(`    ✗ ${file.path}: size ${head.ContentLength} ≠ local ${file.bytes}`);
          problems++;
          continue;
        }

        if (DEEP) {
          // Re-download and rehash. Slow, but the only way to detect a
          // same-size mutation — which is exactly what a targeted tamper
          // would look like.
          const obj = await s3Client().send(
            new GetObjectCommand({ Bucket: bucket, Key: key }),
          );
          const body = Buffer.from(await obj.Body!.transformToByteArray());
          const actual = `sha384-${createHash("sha384").update(body).digest("base64")}`;

          if (actual !== file.integrity) {
            console.error(`    ✗ ${file.path}: HASH MISMATCH — uploaded bytes differ from local`);
            problems++;
            continue;
          }
        }

        console.log(`    = ${file.path}`);
      } catch {
        console.error(`    ✗ ${file.path}: not uploaded`);
        problems++;
      }
    }

    if (problems > 0) {
      console.error(`\n  ${problems} problem(s). Re-run without --check to upload.\n`);
      process.exit(1);
    }

    console.log(`\n  All present${DEEP ? " and hashes match" : ""}.\n`);
    return;
  }

  if (DRY_RUN) {
    console.log(`\n  (dry run — nothing uploaded or registered)\n`);
    return;
  }

  // ---- Upload ----
  if (files.length > 0) {
    console.log(`\n  Uploading to ${prefix}/`);

    for (const file of files) {
      const key = `${prefix}/${file.path}`;

      // Skip when already present at the same size. The prefix is
      // version-scoped and immutable, so an existing object is the same object
      // — re-running the seeder is a cheap no-op.
      try {
        const head = await s3Client().send(
          new HeadObjectCommand({ Bucket: bucket, Key: key }),
        );

        if (head.ContentLength === file.bytes) {
          console.log(`    = ${file.path} (already present)`);
          continue;
        }

        // Same key, different size. Either the local file changed without a
        // version bump, or something overwrote the canonical copy.
        console.error(
          `    ✗ ${file.path} exists with a different size.\n` +
          `      ${prefix}/ is immutable — bump the version rather than replacing it.`,
        );
        process.exit(1);
      } catch {
        // Not found — upload.
      }

      await s3Client().send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: readFileSync(file.absolutePath),
          ContentType: file.contentType,
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );

      console.log(`    ↑ ${file.path}`);
    }
  }

  // ---- Register ----
  console.log(`\n  Registering…`);

  const supabase = await adminSession();

  const { data, error } = await supabase.rpc("admin_upsert_vendor_version", {
    p_package_id: config.id,
    p_display_name: config.displayName,
    p_kind: config.kind,
    p_allowed_strategies: config.allowedStrategies,
    p_license_spdx: config.license.spdx,
    p_requires_attribution: config.license.requiresAttribution,
    p_attribution_text: config.license.attributionText ?? null,
    p_notice_url: config.license.noticeUrl ?? null,
    p_version: config.version,
    p_files: files.map((f) => ({
      path: f.path,
      integrity: f.integrity,
      contentType: f.contentType,
      entry: f.entry,
    })),
    p_glyphs: glyphs,
    p_faces: config.faces ?? null,
  });

  if (error) {
    // "already exists with different contents" is the immutability guard doing
    // its job, not a transient failure — bump the version.
    console.error(`  ✗ ${error.message}\n`);
    process.exit(1);
  }

  const result = (data as { result: string }).result;
  console.log(`  ${result === "inserted" ? "+" : "="} registry row ${result}\n`);

  console.log(`Next:
  Reference it from a template manifest:

    { packageId: "${config.id}", version: "${config.version}",
      strategy: "${config.allowedStrategies[0]}", required: true }

  Then bump the manifest version and run scripts/sync-manifests.ts.
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});