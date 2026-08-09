// ============================================================================
// lib/sites/client.ts
//
// Data layer for the draft, its media, its preview, and publishing — build
// steps 1, 2, 5, 7 & 10 of site-platform/docs/Form spec.md.
//
// GET/PUT /api/sites/:siteId/draft. Autosave is debounced 800ms after the last
// change and retries with backoff on failure rather than giving up silently —
// see "Autosave" in Form spec.md > Behaviour.
// ============================================================================

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImageAsset, SiteDefinition, ValidationIssue } from "@/site-platform/schema";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { BuildRow, SiteDraftRow } from "./types";

const AUTOSAVE_DEBOUNCE_MS = 800;
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 15_000;
const PREVIEW_DEBOUNCE_MS = 300;

// ============================================================================
// FETCHERS
// ============================================================================

export async function fetchSiteDraft(siteId: string): Promise<SiteDraftRow> {
  const res = await fetch(`/api/sites/${siteId}/draft`, { credentials: "same-origin" });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to load draft (${res.status})`);
  }

  return (await res.json()).site as SiteDraftRow;
}

export async function saveSiteDraft(
  siteId: string,
  definition: Partial<SiteDefinition>,
  templateId?: string | null,
): Promise<string> {
  const res = await fetch(`/api/sites/${siteId}/draft`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ definition, ...(templateId ? { templateId } : {}) }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Save failed (${res.status})`);
  }

  return (await res.json()).savedAt as string;
}

export interface PreviewResult {
  html: string;
  /**
   * Raw — a shape-parse failure returns ZodError issues, a manifest-validation
   * failure returns `ValidationIssue[]`. Field-level mapping is build step 8's
   * job; step 7 only needs to prove the round trip and show *something* is wrong.
   */
  issues: unknown[];
  assetCount: number;
}

/** Omit `definition` to render the stored draft instead of unsaved edits. */
export async function fetchPreview(
  siteId: string,
  definition?: Partial<SiteDefinition>,
): Promise<PreviewResult> {
  const res = await fetch(`/api/sites/${siteId}/preview`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(definition !== undefined ? { definition } : {}),
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    // 422 means "structurally parseable but not ready" — issues, not a dead end.
    if (Array.isArray(body.issues)) {
      return { html: "", issues: body.issues, assetCount: 0 };
    }
    throw new Error(body.error ?? `Preview failed (${res.status})`);
  }

  return { html: body.html, issues: body.issues ?? [], assetCount: body.assetCount ?? 0 };
}

export async function uploadSiteMedia(siteId: string, file: File, alt: string): Promise<ImageAsset> {
  const form = new FormData();
  form.append("file", file);
  form.append("alt", alt);

  const res = await fetch(`/api/sites/${siteId}/media`, {
    method: "POST",
    credentials: "same-origin",
    body: form,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Upload failed (${res.status})`);
  }

  return (await res.json()).asset as ImageAsset;
}

/** Best-effort: the caller clears its own reference regardless of the result. */
export async function deleteSiteMedia(siteId: string, assetId: string): Promise<number> {
  const res = await fetch(`/api/sites/${siteId}/media?assetId=${encodeURIComponent(assetId)}`, {
    method: "DELETE",
    credentials: "same-origin",
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Delete failed (${res.status})`);
  }

  return (await res.json()).deleted as number;
}

/**
 * The seed written when a template is first picked (build step 2).
 *
 * `content` is deliberately omitted rather than half-built: `SiteDefinitionSchema`
 * is only shallowly `.partial()`d on autosave, so a `content` object that's
 * present but missing required nested fields (`meta.title`, `brand.name`, ...)
 * would fail the shape check. Later steps fill `content` in as each form
 * section is built; until then, absent is the only legal "empty".
 */
export function emptySiteDefinition(
  templateId: string,
  templateVersion: string,
): Partial<SiteDefinition> {
  return { templateId, templateVersion };
}

// ============================================================================
// HOOK
// ============================================================================

export type DraftSaveStatus = "idle" | "loading" | "saving" | "saved" | "error";

export interface UseSiteDraftResult {
  /** `null` while loading; `{}` for a site with no draft yet. */
  definition: Partial<SiteDefinition> | null;
  templateId: string | null;
  status: DraftSaveStatus;
  error: string | null;
  /** Server-reported timestamp — never the client clock. */
  savedAt: string | null;
  /** `null` while loading. Build step 10 — the link shown once a build goes live. */
  domain: string | null;
  /** `null` while loading. Build step 11 — SettingsTab's read-only domain display. */
  provisioningStatus: string | null;
  /** Replaces the working definition and schedules a debounced autosave. */
  setDefinition: (next: Partial<SiteDefinition>) => void;
  /**
   * Sets `templateId` and the working definition together and schedules the
   * same debounced autosave — used when a template is first picked (build
   * step 2), so the two never end up saved out of sync.
   */
  selectTemplate: (templateId: string, definition: Partial<SiteDefinition>) => void;
}

/**
 * Load the draft once, then own the local working copy and its autosave.
 *
 * Every `setDefinition` call restarts the 800ms debounce; a save failure
 * retries with exponential backoff (1s, 2s, 4s, ... capped at 15s) instead of
 * dropping the change on the floor.
 */
export function useSiteDraft(siteId: string | null): UseSiteDraftResult {
  const [definition, setDefinitionState] = useState<Partial<SiteDefinition> | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [status, setStatus] = useState<DraftSaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [domain, setDomain] = useState<string | null>(null);
  const [provisioningStatus, setProvisioningStatus] = useState<string | null>(null);

  // Guards the debounced/retried save from firing before the initial load
  // resolves, and from racing a save scheduled just before unmount/siteId change.
  const loadedRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const pendingRef = useRef<{ definition: Partial<SiteDefinition>; templateId: string | null } | null>(null);

  useEffect(() => {
    if (!siteId) return;

    let cancelled = false;
    loadedRef.current = false;
    setStatus("loading");
    setError(null);

    fetchSiteDraft(siteId)
      .then((site) => {
        if (cancelled) return;
        setDefinitionState(site.draft_definition ?? {});
        setTemplateId(site.draft_template_id);
        setSavedAt(site.draft_updated_at);
        setDomain(site.domain);
        setProvisioningStatus(site.provisioning_status);
        setStatus("idle");
        loadedRef.current = true;
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      });

    return () => {
      cancelled = true;
      loadedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [siteId]);

  // Reads from pendingRef rather than the `definition`/`templateId` state, so a
  // retry (which re-invokes this same callback after a delay) always sends the
  // latest values instead of whatever was current when the retry was scheduled.
  const save = useCallback(() => {
    if (!siteId || !loadedRef.current || pendingRef.current === null) return;
    const { definition: toSave, templateId: toSaveTemplateId } = pendingRef.current;

    setStatus("saving");
    setError(null);

    saveSiteDraft(siteId, toSave, toSaveTemplateId)
      .then((savedAtValue) => {
        retryCountRef.current = 0;
        setSavedAt(savedAtValue);
        setStatus("saved");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");

        const delay = Math.min(RETRY_BASE_MS * 2 ** retryCountRef.current, RETRY_MAX_MS);
        retryCountRef.current += 1;
        retryRef.current = setTimeout(save, delay);
      });
  }, [siteId]);

  const commit = useCallback((next: { definition: Partial<SiteDefinition>; templateId: string | null }) => {
    setDefinitionState(next.definition);
    setTemplateId(next.templateId);
    pendingRef.current = next;

    if (!loadedRef.current) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
    retryCountRef.current = 0;
    debounceRef.current = setTimeout(save, AUTOSAVE_DEBOUNCE_MS);
  }, [save]);

  const setDefinition = useCallback((next: Partial<SiteDefinition>) => {
    commit({ definition: next, templateId: pendingRef.current?.templateId ?? templateId });
  }, [commit, templateId]);

  const selectTemplate = useCallback((newTemplateId: string, definition: Partial<SiteDefinition>) => {
    commit({ definition, templateId: newTemplateId });
  }, [commit]);

  return { definition, templateId, status, error, savedAt, domain, provisioningStatus, setDefinition, selectTemplate };
}

export interface UsePreviewResult {
  /** Last successfully rendered markup. Never cleared by a failed/in-flight
   *  render — see "Keep the previous HTML visible" in Form spec.md > Behaviour. */
  html: string;
  issues: unknown[];
  assetCount: number;
  loading: boolean;
  error: string | null;
}

/**
 * Debounced 300ms behind the edit that triggered it — heavier than autosave's
 * 800ms delay so it trails it, per Form spec.md > Behaviour > Preview.
 *
 * Relies on useEffect's own cleanup-then-rerun for the debounce: each new
 * `definition` cancels whatever render was pending and schedules a fresh one,
 * and `cancelled` stops a stale in-flight response from landing after a newer
 * one already has.
 */
export function usePreview(
  siteId: string | null,
  definition: Partial<SiteDefinition> | null,
): UsePreviewResult {
  const [html, setHtml] = useState("");
  const [issues, setIssues] = useState<unknown[]>([]);
  const [assetCount, setAssetCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!siteId || definition === null) return;

    let cancelled = false;
    setLoading(true);

    const timer = setTimeout(() => {
      fetchPreview(siteId, definition)
        .then((result) => {
          if (cancelled) return;
          setError(null);
          setIssues(result.issues);
          setAssetCount(result.assetCount);
          // An issues-only response (e.g. still-incomplete required fields)
          // has no html — blanking the iframe for that would be exactly the
          // "unusable on every keystroke" behaviour the spec calls out.
          if (result.html) setHtml(result.html);
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [siteId, definition]);

  return { html, issues, assetCount, loading, error };
}

// ============================================================================
// PUBLISH — build step 10
// ============================================================================

export interface PublishQueued {
  status: "queued";
  buildId: string;
  versionId?: string;
  versionNumber?: number;
  duplicate: boolean;
  warnings: ValidationIssue[];
}

export interface PublishUnchanged {
  status: "unchanged";
  message?: string;
  warnings: ValidationIssue[];
}

/**
 * A non-2xx response the caller can act on rather than a generic Error —
 * 422 (content not ready) carries `issues`, 409 (still provisioning) carries
 * `detail`. Both still have `.message` for a plain fallback.
 */
export class PublishError extends Error {
  status: number;
  issues?: ValidationIssue[];
  detail?: string;

  constructor(message: string, status: number, issues?: ValidationIssue[], detail?: string) {
    super(message);
    this.name = "PublishError";
    this.status = status;
    this.issues = issues;
    this.detail = detail;
  }
}

/** No idempotency key here — Form spec.md is explicit that it's server-generated; sending one lets a client collide with someone else's build. */
export async function publishSite(
  siteId: string,
  body: { definition: Partial<SiteDefinition>; templateId?: string; templateVersion?: string; note?: string },
): Promise<PublishQueued | PublishUnchanged> {
  const res = await fetch(`/api/sites/${siteId}/publish`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));

  if (res.status === 202) {
    return {
      status: "queued",
      buildId: json.buildId,
      versionId: json.versionId,
      versionNumber: json.versionNumber,
      duplicate: Boolean(json.duplicate),
      warnings: json.warnings ?? [],
    };
  }

  if (res.status === 200 && json.status === "unchanged") {
    return { status: "unchanged", message: json.message, warnings: json.warnings ?? [] };
  }

  throw new PublishError(
    json.error ?? `Publish failed (${res.status})`,
    res.status,
    json.issues,
    json.detail,
  );
}

// ============================================================================
// BUILD STATUS — Realtime, not polled. See Form spec.md > API contracts >
// Build status.
// ============================================================================

/**
 * Subscribes to `private.builds` filtered by `site_id`. Any build for this
 * site updates state — fine, since `builds_one_active_per_site` means only
 * one is ever in flight, and seeing a prior build's terminal row on mount
 * (before a new publish) is the "was this already published" signal, not noise.
 */
export function useBuildStatus(siteId: string | null): BuildRow | null {
  const [build, setBuild] = useState<BuildRow | null>(null);

  useEffect(() => {
    if (!siteId) return;

    const supabase = createBrowserClient();
    const channel = supabase
      .channel(`builds:${siteId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "private", table: "builds", filter: `site_id=eq.${siteId}` },
        (payload) => setBuild(payload.new as BuildRow),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [siteId]);

  return build;
}
