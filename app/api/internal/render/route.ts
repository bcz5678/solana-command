// ============================================================================
// app/api/internal/render/route.ts
//
// POST /api/internal/render
//
// Thin wrapper over renderDefinition() for dry runs and debugging. The build
// path does NOT go through here — dispatch calls renderDefinition() in-process
// rather than round-tripping a multi-hundred-KB document through localhost HTTP.
//
// renderDefinition itself lives in lib/internal/render.ts. Next.js route files
// may only export HTTP verb handlers plus a fixed set of config values;
// exporting anything else fails the build with
//   "renderDefinition" is not a valid Route export field.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireInternalAuth } from "@/lib/internal/guard";
import { renderDefinition } from "@/lib/internal/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const denied = requireInternalAuth(req);
  if (denied) return denied;

  let body: {
    definition?: unknown;
    strict?: boolean;
    rendererKey?: string;
    s3Prefix?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.definition) {
    return NextResponse.json({ error: "definition is required" }, { status: 400 });
  }

  try {
    const result = await renderDefinition(body.definition, {
      strict: body.strict,
      rendererKey: body.rendererKey,
      s3Prefix: body.s3Prefix,
    });

    return NextResponse.json(result, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    // 422 rather than 500 for validation failures. The caller needs to
    // distinguish "your content is wrong" from "the renderer is broken" —
    // only one of those is worth retrying.
    const issues = (err as Error & { issues?: unknown }).issues;

    if (issues) {
      return NextResponse.json({ error: "Validation failed", issues }, { status: 422 });
    }

    console.error("[render] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Render failed" },
      { status: 500 },
    );
  }
}