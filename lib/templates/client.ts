// ============================================================================
// lib/templates/client.ts
//
// Typed access to the template catalog from the browser.
//
// Replaces whatever was calling /api/site-templates. Two things changed beyond
// the URL: manifests are validated rather than assumed, and every entry now
// carries `kind`, which decides whether the form shows a Design tab at all.
// ============================================================================

"use client";

import { useEffect, useState, useCallback } from "react";
import { TemplateManifest } from "@/site-platform/schema";
import { TemplateListEntry } from "./types";

// ============================================================================
// FETCHERS
// ============================================================================

export async function fetchTemplates(opts?: {
  includeInactive?: boolean;
  fresh?: boolean;
}): Promise<TemplateListEntry[]> {
  const params = new URLSearchParams();
  if (opts?.includeInactive) params.set("includeInactive", "true");
  if (opts?.fresh) params.set("fresh", "1");

  const res = await fetch(`/api/templates?${params}`, { credentials: "same-origin" });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to load templates (${res.status})`);
  }

  const body = await res.json();

  // A malformed manifest is omitted server-side rather than crashing the list.
  // Surface it: "my template disappeared" is a much worse debugging experience
  // than a console warning naming the bad row.
  if (body.malformed?.length) {
    console.warn(
      "[templates] omitted malformed manifest(s):",
      body.malformed.join(", "),
      "— re-run scripts/sync-manifests.ts",
    );
  }

  return body.templates as TemplateListEntry[];
}

/**
 * Fetch one manifest.
 *
 * ALWAYS pass `version` when editing an existing site — its pinned version, not
 * the latest. Loading the latest manifest for a site pinned to an older one
 * renders fields the site's renderer cannot handle, and publish then fails
 * against a manifest the author never saw.
 */
export async function fetchTemplateManifest(
  templateId: string,
  version?: string,
): Promise<TemplateManifest> {
  const query = version ? `?version=${encodeURIComponent(version)}` : "";
  const res = await fetch(`/api/templates/${templateId}${query}`, {
    credentials: "same-origin",
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to load template ${templateId}`);
  }

  return (await res.json()).manifest as TemplateManifest;
}

// ============================================================================
// HOOKS
// ============================================================================

export function useTemplates(opts?: { includeInactive?: boolean }) {
  const [templates, setTemplates] = useState<TemplateListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    setError(null);
    try {
      setTemplates(await fetchTemplates({ ...opts, fresh }));
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts?.includeInactive]);

  useEffect(() => { void load(); }, [load]);

  return { templates, loading, error, refresh: () => load(true) };
}

export function useTemplateManifest(templateId?: string, version?: string) {
  const [manifest, setManifest] = useState<TemplateManifest | null>(null);
  const [loading, setLoading] = useState(Boolean(templateId));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!templateId) {
      setManifest(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetchTemplateManifest(templateId, version)
      .then((m) => { if (!cancelled) { setManifest(m); setError(null); } })
      .catch((err) => { if (!cancelled) setError(err); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [templateId, version]);

  return { manifest, loading, error };
}

// ============================================================================
// FORM CAPABILITY HELPERS
//
// Everything the form needs to decide what to render comes from the manifest.
// These exist so the branch logic lives in one place rather than scattered
// through components — and so adding a template never means touching the form.
// ============================================================================

/**
 * Slotted templates have a fixed look inherited from the imported source, so
 * the Design tab would present controls that change nothing. The schema
 * enforces empty usesThemeKeys/customThemeSchema for them; this is the UI side.
 */
export function showsDesignTab(manifest: TemplateManifest): boolean {
  return manifest.kind === "tokenized" && manifest.usesThemeKeys.length > 0;
}

/**
 * Whether the section editor should appear at all.
 *
 * A slotted template whose repeaters cover no sections has sectionCount.max
 * of 0 — the source's regions are all fixed, and only hero/meta/module fields
 * are editable.
 */
export function showsSectionEditor(manifest: TemplateManifest): boolean {
  return manifest.sectionCount.max > 0 && manifest.supportedSectionTypes.length > 0;
}

/** Short label for the picker, so the tradeoff is visible before selection. */
export function configurabilityLabel(manifest: TemplateManifest): string {
  if (manifest.kind === "slotted") return "Fixed design";
  return manifest.usesThemeKeys.length > 8 ? "Fully customizable" : "Limited theming";
}

/** Dotted content paths the template refuses to publish without. */
export function requiredPaths(manifest: TemplateManifest): Set<string> {
  return new Set(manifest.requiredContent);
}

/** Target aspect for a slot, for the CSS focal-point crop preview. */
export function aspectFor(
  manifest: TemplateManifest,
  slot: "hero" | "section" | "card" | "gallery",
): string {
  return manifest.imageAspect[slot] ?? "16/9";
}