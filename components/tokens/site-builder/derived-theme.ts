// ============================================================================
// Preview of what resolveTheme() would derive for a semantic token the author
// hasn't overridden — build step 9's semantic gap fix.
//
// Imports theme.ts DIRECTLY, not the @site/renderer barrel: that barrel is
// server-only (node:crypto, per its own file header) and cannot reach a
// client component. theme.ts itself only touches escape.ts/types.ts, both
// pure, so this one file is the only safe way in from here.
// ============================================================================

import { mergeCore, LayeredThemeSchema, type PartialCore, type TemplateManifest } from '@/site-platform/schema'
import { resolveTheme } from '@/site-platform/renderer/theme'

/**
 * The core colours resolveTheme() actually reads when deriving semantic
 * fallbacks (see its "Semantic derivation" section). Everything else it
 * touches (typography/spacing/motion/breakpoints) gets filled by mergeCore
 * below — cssValue() falls back gracefully for values it can't find, so only
 * the colours a real derivation depends on need to be genuinely present.
 */
const REQUIRED_CORE_COLORS = [
    'background', 'surface', 'primary', 'onPrimary', 'secondary',
    'text', 'textMuted', 'border', 'overlay', 'success', 'warning', 'error',
] as const

/** CSS var resolveTheme() emits for each SemanticTokensSchema key — see site-platform/renderer/theme.ts. */
export const SEMANTIC_CSS_VAR: Record<string, string> = {
    textOnImage: '--st-text-on-image',
    surfaceElevated: '--st-surface-elevated',
    navBackground: '--st-nav-bg',
    navForeground: '--st-nav-fg',
    footerBackground: '--st-footer-bg',
    footerForeground: '--st-footer-fg',
    footerBorder: '--st-footer-border',
    overlayScrim: '--st-overlay-scrim',
    mobileMenuBackground: '--st-mobile-menu-bg',
}

export interface DerivedVarsResult {
    /**
     * Resolved vars, or null when there's nothing to preview yet — either too
     * little is typed (REQUIRED_CORE_COLORS incomplete) or a value typed so
     * far can't resolve (see `error`). The UI treats both cases the same: no
     * preview shown.
     */
    vars: Record<string, string> | null
    /**
     * Set when the assembled theme fails LayeredThemeSchema, or resolveTheme
     * throws against a theme that DID parse. A bare `null` for both "nothing
     * to derive yet" and "this is actually broken" is what made a dead
     * preview invisible before (core.button, specifically) — this is the
     * caller's hook to log it somewhere a developer will see it, without the
     * UI itself having to change.
     */
    error?: string
}

/**
 * Best-effort — `vars: null` rather than a value computed from missing core
 * colours, which would just be a confusing placeholder for a placeholder.
 */
export function tryResolveDerivedVars(
    theme: Record<string, unknown> | undefined,
    manifest: TemplateManifest,
): DerivedVarsResult {
    const core = theme?.core as Record<string, unknown> | undefined
    const colors = core?.colors as Record<string, unknown> | undefined
    if (!colors || REQUIRED_CORE_COLORS.some((key) => !colors[key])) return { vars: null }

    // mergeCore fills every defaulted group by construction — the editor
    // holds partial, mid-edit state, which is exactly what mergeCore exists
    // for — so nothing downstream can see an unpopulated group the way the
    // old `as LayeredTheme` cast let core.button through unpopulated.
    const mergedCore = mergeCore({
        colors,
        typography: core?.typography,
        spacing: core?.spacing,
        motion: core?.motion,
        breakpoints: core?.breakpoints,
        shadows: core?.shadows,
        button: core?.button,
    } as PartialCore)

    // The real safety net. mergeCore merges structurally without checking
    // value types; this is what actually catches a malformed draft (a colour
    // typed as a number, for instance) rather than trusting the cast above.
    const parsed = LayeredThemeSchema.safeParse({
        id: 'preview',
        name: 'preview',
        mode: 'dark',
        core: mergedCore,
        semantic: theme?.semantic,
        templates: theme?.templates,
    })

    if (!parsed.success) {
        return { vars: null, error: `Derived theme failed schema validation: ${parsed.error.message}` }
    }

    try {
        return { vars: resolveTheme({ theme: parsed.data, manifest }).vars }
    } catch (err) {
        // A theme that DID parse but still threw inside resolveTheme — a
        // half-typed value mid-keystroke (e.g. "#ab"), most likely, but this
        // is also exactly how a resolveTheme bug against otherwise-valid
        // input would show up. Worth a signal either way.
        return {
            vars: null,
            error: `resolveTheme threw on a parsed theme: ${err instanceof Error ? err.message : String(err)}`,
        }
    }
}
