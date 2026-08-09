import { SiteDefinition } from "@/site-platform/schema";

/**
 * Row shape from `GET /api/sites/:siteId/draft`. `draft_definition` is `null`
 * until the first autosave; once a template is selected it's a
 * `Partial<SiteDefinition>` — autosave parses leniently, so it may not satisfy
 * the full schema until publish.
 */
export interface SiteDraftRow {
  id: string;
  name: string;
  domain: string;
  provisioning_status: string;
  draft_definition: Partial<SiteDefinition> | null;
  draft_template_id: string | null;
  draft_updated_at: string | null;
  published_version_id: string | null;
  published_at: string | null;
}

/**
 * `private.builds` row, as seen over Realtime — see Form spec.md > API
 * contracts > Build status. Fields beyond `id`/`site_id`/`status` are read
 * defensively (the exact column set isn't visible from this codebase, only
 * from the SQL migrations): `error_detail` is the free-form payload
 * `reportFailureQuietly`/n8n's callback pass as `detail` (phase, message,
 * stack, ...); `validation_issues` may arrive either as its own column or
 * nested inside `error_detail`, so callers should check both.
 */
export interface BuildRow {
  id: string;
  site_id: string;
  status: "queued" | "claimed" | "validating" | "rendering" | "uploading" | "invalidating" | "live" | "failed" | "cancelled";
  version_id?: string | null;
  version_number?: number | null;
  error_detail?: Record<string, unknown> | null;
  validation_issues?: Array<{ path: string; severity: "error" | "warning"; message: string }> | null;
  heartbeat_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}
