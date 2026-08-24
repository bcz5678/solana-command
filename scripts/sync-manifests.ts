// ============================================================================
// scripts/sync-manifests.ts — run in CI on merge to main.
//
//   pnpm tsx scripts/sync-manifests.ts [--check]
//
// Pushes every registered template's manifest and presets into the database,
// so rows are derived from code rather than hand-maintained beside it.
//
// TWO DIFFERENT CONTRACTS, and conflating them was the bug in the previous
// version of this script:
//
//   manifests  IMMUTABLE per (template_id, version). A trigger raises on an
//              upsert against an existing pair, because sites pinned to that
//              version must keep rendering the way they were published.
//
//   presets    MUTABLE. A preset is copied into the site at creation and never
//              read again, so editing one cannot change any existing site.
//              Requiring a version bump to fix a typo in preset copy would be
//              friction with no safety payoff.
//
// The immutability trigger also means a naive re-run RAISES on every unchanged
// template. This script compares first and skips identical manifests, so the
// only error CI ever sees is the one that matters: a manifest changed without
// its version being bumped.
// ============================================================================

import { createAdminClient } from "@/lib/supabase/admin";
import { TEMPLATES } from "@site/renderer";
import type { TemplateManifest, TemplatePreset } from "@site/schema";

const CHECK = process.argv.includes("--check");

interface RegisteredTemplate {
  manifest: TemplateManifest;
  presets: TemplatePreset[];
}

interface Drift {
  kind: "manifest-changed" | "preset-changed" | "preset-orphaned" | "missing";
  what: string;
  detail?: string;
}

const supabase = createAdminClient();

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const templates = Object.values(TEMPLATES) as RegisteredTemplate[];

  if (templates.length === 0) {
    // An empty registry syncing "successfully" would silently prune every
    // preset row in the database.
    console.error("No templates registered — refusing to sync an empty registry.");
    process.exit(1);
  }

  const drift: Drift[] = [];

  for (const template of templates) {
    await syncManifest(template.manifest, drift);
    await syncPresets(template.manifest, template.presets, drift);
  }

  if (CHECK) {
    if (drift.length === 0) {
      console.log(`OK — ${templates.length} template(s) in sync.`);
      return;
    }

    for (const d of drift) {
      console.error(`${d.kind.padEnd(18)} ${d.what}${d.detail ? `  ${d.detail}` : ""}`);
    }
    process.exit(1);
  }

  console.log(`Synced ${templates.length} template(s).`);
}

// ============================================================================
// MANIFESTS
// ============================================================================

async function syncManifest(manifest: TemplateManifest, drift: Drift[]): Promise<void> {
  const label = `${manifest.id}@${manifest.version}`;

  const { data: existing, error } = await supabase.rpc("get_template_version", {
    p_template_id: manifest.id,
    p_version: manifest.version,
  });

  if (error) throw new Error(`${label}: ${error.message}`);

  if (existing) {
    // Identical is a no-op, not an error. Without this the immutability
    // trigger raises on every re-run of an unchanged template and CI cannot
    // distinguish "nothing changed" from "you forgot to bump the version".
    if (canonical(existing.manifest) === canonical(manifest)) return;

    drift.push({
      kind: "manifest-changed",
      what: label,
      detail: "manifest differs from the stored row — bump the version.",
    });

    if (!CHECK) {
      throw new Error(
        `${label}: manifest changed but the version did not. Sites pinned to ` +
        `this version must keep rendering as published — bump \`version\` in ` +
        `manifest.ts and re-run.`,
      );
    }
    return;
  }

  if (CHECK) {
    drift.push({ kind: "missing", what: label, detail: "not yet synced." });
    return;
  }

  const { error: upsertError } = await supabase.rpc("admin_upsert_template_version", {
    p_template_id: manifest.id,
    p_version: manifest.version,
    p_renderer_key: manifest.rendererKey,
    p_manifest: manifest,
  });

  if (upsertError) throw new Error(`${label}: ${upsertError.message}`);
  console.log(`  + manifest ${label}`);
}

// ============================================================================
// PRESETS
// ============================================================================

async function syncPresets(
  manifest: TemplateManifest,
  presets: TemplatePreset[],
  drift: Drift[],
): Promise<void> {
  const label = `${manifest.id}@${manifest.version}`;

  if (presets.length === 0) {
    // .min(1) on the manifest makes this unreachable through normal authoring,
    // so if it happens the registry export is wrong rather than the template.
    drift.push({ kind: "missing", what: label, detail: "no presets exported." });
    return;
  }

  const defaults = presets.filter((p) => p.isDefault);
  if (defaults.length !== 1) {
    throw new Error(
      `${label}: ${defaults.length} preset(s) marked isDefault; exactly one is required. ` +
      `The unique index would reject this anyway, but with a constraint name rather ` +
      `than an explanation.`,
    );
  }

  const { data: rows, error } = await supabase.rpc("list_template_presets", {
    p_template_id: manifest.id,
    p_template_version: manifest.version,
  });

  if (error) throw new Error(`${label}: ${error.message}`);

  const stored = new Map<string, unknown>();
  for (const row of rows ?? []) stored.set(row.preset_id, row);

  for (const preset of presets) {
    // Presets carry their own templateId/templateVersion; a mismatch means the
    // file was copied between templates and never updated, which would sync
    // under the wrong key and materialize against the wrong manifest.
    if (preset.templateId !== manifest.id || preset.templateVersion !== manifest.version) {
      throw new Error(
        `${label}: preset "${preset.id}" claims ` +
        `${preset.templateId}@${preset.templateVersion}.`,
      );
    }

    if (CHECK) {
      const { data: current } = await supabase.rpc("get_template_preset", {
        p_template_id: manifest.id,
        p_template_version: manifest.version,
        p_preset_id: preset.id,
      });

      if (!current) {
        drift.push({ kind: "missing", what: `${label}/${preset.id}` });
      } else if (canonical(current) !== canonical(preset)) {
        drift.push({ kind: "preset-changed", what: `${label}/${preset.id}` });
      }
      continue;
    }

    const { error: upsertError } = await supabase.rpc("admin_upsert_template_preset", {
      p_template_id: manifest.id,
      p_template_version: manifest.version,
      p_preset_id: preset.id,
      p_preset: preset,
    });

    if (upsertError) throw new Error(`${label}/${preset.id}: ${upsertError.message}`);
    console.log(`  + preset ${label}/${preset.id}`);
  }

  // Prune. A preset deleted in code but left in the database stays selectable
  // in the wizard, and site creation then fails at materialization naming a
  // preset id nobody recognises.
  const keep = presets.map((p) => p.id);
  const orphans = [...stored.keys()].filter((id) => !keep.includes(id));

  if (orphans.length === 0) return;

  if (CHECK) {
    for (const id of orphans) drift.push({ kind: "preset-orphaned", what: `${label}/${id}` });
    return;
  }

  const { data: deleted, error: pruneError } = await supabase.rpc(
    "admin_prune_template_presets",
    { p_template_id: manifest.id, p_template_version: manifest.version, p_keep: keep },
  );

  if (pruneError) throw new Error(`${label}: ${pruneError.message}`);
  if (deleted) console.log(`  - pruned ${deleted} preset(s) from ${label}`);
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Stable serialization for comparison.
 *
 * Key order differs between a JS object and a jsonb round-trip, so a plain
 * JSON.stringify comparison reports drift on every unchanged manifest — which
 * would make the immutability check fire constantly and get ignored.
 */
function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, sortKeys(v)]),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});