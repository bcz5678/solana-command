/**
 * Generic dotted-path get/set over plain objects — used by DesignTab (build
 * step 9) to read/write `theme.core.colors.primary`-style paths without a
 * bespoke accessor per token. No array-bracket support: unlike section
 * paths, `usesThemeKeys` never indexes into an array (Form spec.md > Design
 * tab — "dotted paths into theme.core / theme.semantic").
 */

export function getPath(obj: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((acc, key) => {
        if (acc === null || typeof acc !== 'object') return undefined
        return (acc as Record<string, unknown>)[key]
    }, obj)
}

/** Immutable — returns a new object, creating intermediate objects as needed. */
export function setPath(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
    const [key, ...rest] = path.split('.')
    if (rest.length === 0) {
        return { ...obj, [key]: value }
    }
    const child = (obj[key] ?? {}) as Record<string, unknown>
    return { ...obj, [key]: setPath(child, rest.join('.'), value) }
}
