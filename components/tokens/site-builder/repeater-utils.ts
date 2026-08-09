/** Swaps the item at `from` with the one at `to`. Out-of-range `to` is a no-op. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
    if (to < 0 || to >= items.length) return items
    const next = [...items]
    ;[next[from], next[to]] = [next[to], next[from]]
    return next
}
