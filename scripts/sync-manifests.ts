// ============================================================================
// SYNC
// ============================================================================

/*
 * scripts/sync-manifests.ts — run in CI on merge to main.
 *
 * Upserts each registered template's manifest into private.template_versions,
 * so the database row is derived from code rather than hand-maintained
 * alongside it.
 *
 *   import { heroOnepagerManifest } from "@site/renderer/templates/...";
 *
 *   await supabase.rpc("admin_upsert_template_version", {
 *     p_template_id: heroOnepagerManifest.id,
 *     p_version:     heroOnepagerManifest.version,
 *     p_renderer_key: heroOnepagerManifest.rendererKey,
 *     p_manifest:    heroOnepagerManifest,
 *   });
 *
 * Note the immutability trigger on template_versions: an upsert against an
 * EXISTING (template_id, version) will raise. That is intentional — changing a
 * manifest requires bumping the version, because sites pinned to the old one
 * must keep rendering the way they were published. CI should treat that error
 * as "you forgot to bump the version", not as a failure to retry.
 */

    import { heroOnepagerManifest } from "@site/renderer/templates/...";
 
    await supabase.rpc("admin_upsert_template_version", {
        p_template_id: heroOnepagerManifest.id,
        p_version:     heroOnepagerManifest.version,
        p_renderer_key: heroOnepagerManifest.rendererKey,
        p_manifest:    heroOnepagerManifest,
    });