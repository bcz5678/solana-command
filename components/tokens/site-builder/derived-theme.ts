// ============================================================================
// Preview of what resolveTheme() would derive for a semantic token the author
// hasn't overridden — build step 9's semantic gap fix.
//
// Imports theme.ts DIRECTLY, not the @site/renderer barrel: that barrel is
// server-only (node:crypto, per its own file header) and cannot reach a
// client component. theme.ts itself only touches escape.ts/types.ts, both
// pure, so this one file is the only safe way in from here.
// ============================================================================

import { LayeredTheme, TemplateManifest } from '@/site-platform/schema'
import { resolveTheme } from '@/site-platform/renderer/theme'

/**
 * The core colours resolveTheme() actually reads when deriving semantic
 * fallbacks (see its "Semantic derivation" section). Everything else it
 * touches (typography/spacing/motion/breakpoints) gets a safe `{}` below —
 * cssValue() falls back gracefully for values it can't find, so only the
 * colours a real derivation depends on need to be genuinely present.
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

/**
 * Best-effort — returns null rather than a value computed from missing core
 * colours, which would just be a confusing placeholder for a placeholder.
 * The try/catch is a backstop, not the primary guard: REQUIRED_CORE_COLORS
 * covers the known failure mode; anything else just means no preview yet.
 */
export function tryResolveDerivedVars(
    theme: Record<string, unknown> | undefined,
    manifest: TemplateManifest,
): Record<string, string> | null {
    const core = theme?.core as Record<string, unknown> | undefined
    const colors = core?.colors as Record<string, unknown> | undefined
    if (!colors || REQUIRED_CORE_COLORS.some((key) => !colors[key])) return null

    try {
        const resolved = resolveTheme({
            theme: {
                id: 'preview',
                name: 'preview',
                mode: 'dark',
                core: {
                    colors,
                    typography: core?.typography ?? {},
                    spacing: core?.spacing ?? {},
                    motion: core?.motion ?? {},
                    breakpoints: core?.breakpoints ?? {},
                    shadows: core?.shadows,
                },
                semantic: theme?.semantic,
                templates: theme?.templates,
                // Cast: this is a deliberately patched preview object, not a
                // real LayeredTheme — the draft it's built from is mid-edit by
                // definition.
            } as LayeredTheme,
            manifest,
        })
        return resolved.vars
    } catch {
        return null
    }
}
