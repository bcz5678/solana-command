import { requireSuperAdmin } from '@/lib/auth/require-super-admin'
import { relay } from '@/lib/wss/relay-instance'

export async function POST(request: Request): Promise<Response> {
    try {
        await requireSuperAdmin()
    } catch (res) {
        return res as Response
    }

    const { mint } = await request.json().catch(() => ({}))
    if (typeof mint !== 'string' || !mint) {
        return Response.json({ error: 'mint is required' }, { status: 400 })
    }

    try {
        const result = await relay.unwatchMint(mint)
        return Response.json(result)
    } catch (err) {
        return Response.json(
            { error: err instanceof Error ? err.message : 'Failed to unwatch mint' },
            { status: 502 }
        )
    }
}
