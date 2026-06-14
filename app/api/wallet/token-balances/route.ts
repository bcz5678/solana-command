import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, AccountLayout, getMint } from '@solana/spl-token';
import { initializeConnection } from '@/app/api/utils/helpers';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    let body: { mintAddress: string; walletAddresses: string[] }
    try {
        body = await request.json()
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        })
    }

    const { mintAddress, walletAddresses } = body
    if (!mintAddress || !Array.isArray(walletAddresses) || walletAddresses.length === 0) {
        return new Response(JSON.stringify({ error: 'mintAddress and walletAddresses are required.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        })
    }

    try {
        const connection = initializeConnection()
        const mintPubkey = new PublicKey(mintAddress)

        // Derive associated token addresses for all wallets
        const ownerPubkeys = walletAddresses.map((a) => new PublicKey(a))
        const ataAddresses = ownerPubkeys.map((owner) =>
            getAssociatedTokenAddressSync(mintPubkey, owner),
        )

        // Single batch fetch: mint info + all ATAs in parallel
        const [mintInfo, accountInfos] = await Promise.all([
            getMint(connection, mintPubkey),
            connection.getMultipleAccountsInfo(ataAddresses),
        ])

        const { decimals } = mintInfo
        const balances: Record<string, string> = {}

        for (let i = 0; i < walletAddresses.length; i++) {
            const info = accountInfos[i]
            if (!info?.data || info.data.length < AccountLayout.span) {
                balances[walletAddresses[i]] = '0'
                continue
            }
            const decoded = AccountLayout.decode(info.data as Buffer)
            // Return raw integer amount (like lamports) — callers apply decimals themselves
            balances[walletAddresses[i]] = decoded.amount.toString()
        }

        return new Response(JSON.stringify({ balances, decimals }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch token balances.'
        return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        })
    }
}
