// Bridges the server-side relay singleton (lib/wss) to the browser via SSE —
// browsers can't use the `ws` package, and EventSource gives us push delivery
// plus automatic reconnect for free.

import { requireSuperAdmin } from '@/lib/auth/require-super-admin'
import { relay } from '@/lib/wss/relay-instance'
import type { RelayMessage } from '@/lib/wss/types'

export const dynamic = 'force-dynamic'

const MESSAGE_TYPES: RelayMessage['type'][] = [
    'token-launch',
    'coin-transaction',
    'wallet-transaction',
    'status',
    'heartbeat',
]

export async function GET(request: Request): Promise<Response> {
    try {
        await requireSuperAdmin()
    } catch (res) {
        return res as Response
    }

    const encoder = new TextEncoder()

    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            const send = (msg: RelayMessage) => {
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
