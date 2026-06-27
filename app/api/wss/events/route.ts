// Bridges the server-side relay singleton (lib/wss) to the browser via SSE —
// browsers can't use the `ws` package, and EventSource gives us push delivery
// plus automatic reconnect for free.

import { requireSuperAdmin } from '@/lib/auth/require-super-admin'
import { relay } from '@/lib/wss/relay-instance'
import type { RelayMessage } from '@/lib/wss/types'

export const dynamic = 'force-dynamic'

const MESSAGE_TYPES: RelayMessage['type'][] = [
    'token-launch',
    'token-transaction',
    'wallet-transaction',
    'status',
    'heartbeat',
    'token-state',
]

function parseList(param: string | null): Set<string> | null {
    if (!param) return null
    const values = param.split(',').map((v) => v.trim()).filter(Boolean)
    return values.length > 0 ? new Set(values) : null
}

/**
 * True if `set` matches against `value`, or if `set` isn't active for this
 * call — lets a caller OR together multiple filter dimensions without an
 * inactive one (null) forcing a vacuous true and swallowing the others.
 */
function matches(set: Set<string> | null, value: string | null | undefined): boolean {
    return set !== null && value != null && set.has(value)
}

/**
 * Whether `msg` is in scope for the given mint/wallet filters. Message types
 * with neither field (status, heartbeat) are connection-level, not data to
 * scope, so they always pass. Types that carry only one dimension (token-launch,
 * token-state) are unaffected by a filter on the other dimension. When both
 * filters are active on a type that carries both (token-transaction,
 * wallet-transaction), a match on either one is enough — broadest "things I'm
 * watching" semantics.
 */
function matchesFilters(msg: RelayMessage, mints: Set<string> | null, wallets: Set<string> | null): boolean {
    if (!mints && !wallets) return true

    switch (msg.type) {
        case 'token-launch':
        case 'token-state':
            return !mints || matches(mints, msg.mint)
        case 'token-transaction':
            return matches(mints, msg.mint) || matches(wallets, msg.wallet)
        case 'wallet-transaction': {
            if (matches(wallets, msg.wallet)) return true
            if (!mints) return false
            return msg.tokenChanges.some((c) => mints.has(c.mint))
        }
        case 'status':
        case 'heartbeat':
            return true
    }
}

export async function GET(request: Request): Promise<Response> {
    try {
        await requireSuperAdmin()
    } catch (res) {
        return res as Response
    }

    const url = new URL(request.url)
    const mints = parseList(url.searchParams.get('mint'))
    const wallets = parseList(url.searchParams.get('wallet'))

    const encoder = new TextEncoder()

    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            const send = (msg: RelayMessage) => {
                if (!matchesFilters(msg, mints, wallets)) return
                try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`))
                } catch {
                    // controller already closed (client disconnected mid-write) — ignore
                }
            }

            for (const type of MESSAGE_TYPES) relay.on(type, send)

            request.signal.addEventListener('abort', () => {
                for (const type of MESSAGE_TYPES) relay.off(type, send)
                try {
                    controller.close()
                } catch {
                    // already closed
                }
            })
        },
    })

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
        },
    })
}
