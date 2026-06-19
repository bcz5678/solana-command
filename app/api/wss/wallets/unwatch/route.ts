import { requireSuperAdmin } from '@/lib/auth/require-super-admin'
import { relay } from '@/lib/wss/relay-instance'

export async function POST(request: Request): Promise<Response> {
    try {
        await requireSuperAdmin()
    } catch (res) {
        return res as Response
    }

    const { wallet } = await request.json().catch(() => ({}))
    if (typeof wallet !== 'string' || !wallet) {
        return Response.json({ error: 'wallet is required' }, { status: 400 })
    }

    try {
        const result = await relay.unwatchWallet(wallet)
        return Response.json(result)
    } catch (err) {
        return Response.json(
            { error: err instanceof Error ? err.message : 'Failed to unwatch wallet' },
            { status: 502 }
        )
    }
}
