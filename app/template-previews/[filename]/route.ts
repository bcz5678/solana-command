// ============================================================================
// app/template-previews/[filename]/route.ts
//
// GET /template-previews/:filename.png
//
// Serves template preview screenshots from the repo-root `template-previews/`
// directory — NOT `public/`. That directory is where the site-builder
// wizard's template upload writes to, so it can't simply be moved under
// `public/`: Next only serves static files from there, and nothing else on
// disk is reachable by a bare URL. This route is what makes the root
// directory reachable instead, without touching the upload path at all.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREVIEWS_DIR = path.resolve(process.cwd(), "template-previews");

// Matches the naming convention scripts/import-bundle.ts's scaffold generator
// already emits: `${templateId}.png`. Rejecting anything else also rejects
// path traversal (`../`, absolute paths) before it ever reaches the filesystem.
const FILENAME_RE = /^[a-z0-9][a-z0-9-]*\.png$/;

type Params = { params: Promise<{ filename: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { filename } = await params;

  if (!FILENAME_RE.test(filename)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const buf = await readFile(path.join(PREVIEWS_DIR, filename));
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        // Template previews change rarely and the URL is stable per template —
        // safe to cache, unlike per-user content.
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
