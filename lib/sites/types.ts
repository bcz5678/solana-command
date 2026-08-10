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
 * Row shape from `GET /api/sites` (the `list_sites()` RPC) — the "Edit
 * Existing Site" picker. Distinct from `SiteDraftRow`: this is the summary
 * row for picking a site, not the draft content loaded once one is chosen.
 */
export interface SiteRow {
  id: string;
  name: string;
  token_symbol: string;
  contract_address: string;
  domain: string | null;
  domain_source: "purchase" | "in_account" | "external" | null;
  s3_prefix: string | null;
  provisioning_status: string;
  distribution_id: string | null;
  published_at: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  is_publishable: boolean;
}

/** Return shape of `create_site()`, via `POST /api/sites`. */
export interface CreateSiteResult {
  site_id: string;
  s3_prefix: string;
  originPath: string;
  extended: boolean;
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
