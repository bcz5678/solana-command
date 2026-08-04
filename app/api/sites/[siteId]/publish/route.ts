// ============================================================================
// app/api/sites/[siteId]/publish/route.ts
//
// POST /api/sites/:siteId/publish
//
// Saves the definition as the draft, snapshots it into an immutable version,
// queues a build, and pokes the dispatcher.
//
// Returns 202 — the work is queued, not done. The client tracks progress over
// Supabase Realtime on private.builds rather than polling this route.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import {
  SiteDefinitionSchema,
  TemplateManifestSchema,
  validateAgainstManifest,
} from "@site/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ siteId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { siteId } = await params;
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    definition?: unknown;
    templateId?: string;
    templateVersion?: string;
    note?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // ---- 1. Strict parse ----
  // Unlike autosave, publish rejects a malformed definition outright. Catching
  // it here gives the form a field-level error path; catching it later means a
  // failed build row the user has to interpret.
  const parsed = SiteDefinitionSchema.safeParse(body.definition);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Definition failed validation",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          severity: "error",
          message: i.message,
        })),
      },
      { status: 422 },
    );
  }

  const definition = parsed.data;
  const templateId = body.templateId ?? definition.templateId;
  const templateVersion = body.templateVersion ?? definition.templateVersion;

  // ---- 2. Manifest validation ----
  // Run here as well as in the renderer. Failing fast in the request the user
  // is watching beats failing three seconds later inside a build they have to
  // go find.
  const { data: manifestRow, error: manifestErr } = await supabase.rpc(
    "get_template_manifest",
    { p_template_id: templateId, p_version: templateVersion },
  );

  if (manifestErr || !manifestRow) {
    return NextResponse.json(
      { error: `Template ${templateId}@${templateVersion} is unavailable` },
      { status: 422 },
    );
  }

  const manifest = TemplateManifestSchema.parse(manifestRow);
  const issues = validateAgainstManifest(definition.content, manifest);
  const errors = issues.filter((i) => i.severity === "error");

  if (errors.length > 0) {
    // 422 with the full issue list — warnings included, so the form can show
    // both the blockers and the advisories in one pass.
    return NextResponse.json(
      { error: "Content is not ready to publish", issues },
      { status: 422 },
    );
  }

  // ---- 3. Persist the draft ----
  // Publishing implicitly saves, so what ships is exactly what the form had.
  // Without this, a user who publishes before autosave fires leaves a draft
  // that no longer matches the live site.
  await supabase.rpc("save_site_draft", {
    p_site_id: siteId,
    p_definition: definition,
    p_template_id: templateId,
  });

  // ---- 4. Snapshot and queue ----
  // Idempotency key is generated SERVER-side. A client-supplied key lets a
  // buggy or hostile client collide with someone else's build, and a client
  // that regenerates on retry defeats the deduplication entirely.
  const idempotencyKey = randomUUID();

  const { data: result, error: publishErr } = await supabase.rpc("publish_site", {
    p_site_id: siteId,
    p_definition: definition,
    p_template_id: templateId,
    p_template_version: templateVersion,
    p_idempotency_key: idempotencyKey,
    p_publish_note: body.note ?? null,
    p_trigger: "user_publish",
  });

  if (publishErr) {
    const message = publishErr.message ?? "";

    if (message.includes("not owned by caller")) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    // The provisioning gate. Domain, cert or distribution isn't ready yet.
    if (message.includes("not ready to publish")) {
      return NextResponse.json(
        { error: "This site's domain and certificate are still provisioning.",
          detail: message },
        { status: 409 },
      );
    }

    if (message.includes("not available for publishing")) {
      return NextResponse.json({ error: message }, { status: 422 });
    }

    console.error("[publish] failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const envelope = result as {
    build_id: string | null;
    version_id?: string;
    version_number?: number;
    status: string;
    duplicate: boolean;
    message?: string;
  };

  // ---- 5. Nothing changed ----
  // publish_site() short-circuits when the definition hash matches the live
  // version. Returning 200 rather than 202 signals "no build to watch".
  if (envelope.status === "unchanged") {
    return NextResponse.json(
      { status: "unchanged", message: envelope.message, warnings: issues },
      { status: 200 },
    );
  }

  // ---- 6. Poke the dispatcher ----
  //
  // Fire-and-forget, deliberately not awaited. The client watches Realtime, so
  // there is no reason to hold the response open through a render.
  //
  // If this call is lost — Next.js restarts, n8n is unreachable, the network
  // blips — the build row still sits in 'queued' and the sweep claims it within
  // three minutes. That durability is the entire reason the queue exists rather
  // than rendering inline here.
  if (envelope.build_id) {
    void fetch(`${process.env.APP_URL}/api/internal/builds/dispatch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": process.env.INTERNAL_API_SECRET!,
      },
      body: JSON.stringify({ workerId: "publish-trigger", max: 1 }),
      signal: AbortSignal.timeout(5_000),
    }).catch((err) => {
      console.warn("[publish] dispatch trigger failed, sweep will pick it up:", err);
    });
  }

  return NextResponse.json(
    {
      buildId: envelope.build_id,
      versionId: envelope.version_id,
      versionNumber: envelope.version_number,
      duplicate: envelope.duplicate,
      // Non-blocking advisories: low overlay opacity, missing alt text, etc.
      warnings: issues.filter((i) => i.severity === "warning"),
    },
    { status: 202 },
  );
}