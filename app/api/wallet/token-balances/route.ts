import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
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

        // Fetch all parsed token accounts for each wallet, batched — each wallet
        // fires 2 RPC calls (SPL Token + Token-2022), so an unbatched Promise.all
        // over e.g. 100 wallets fires 200 concurrent requests at once. QuickNode
        // (and most RPC providers) queue/throttle rather than reject outright at
        // that concurrency, so the symptom is a hang, not a clean error.
        const WALLET_BATCH_SIZE = 20

        async function fetchBatch(addr: string) {
            const owner = new PublicKey(addr)
            const [v1, v2] = await Promise.all([
                connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
                connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }),
            ])
            return { addr, accounts: [...v1.value, ...v2.value] }
        }

        const walletResults: Awaited<ReturnType<typeof fetchBatch>>[] = []
        for (let i = 0; i < walletAddresses.length; i += WALLET_BATCH_SIZE) {
            const batch = walletAddresses.slice(i, i + WALLET_BATCH_SIZE)
            walletResults.push(...await Promise.all(batch.map(fetchBatch)))
        }

        const balances: Record<string, string> = {}
        let decimals = 6

        for (const { addr, accounts } of walletResults) {
            const match = accounts.find(({ account }) => {
                const info = (account.data as any).parsed?.info
                return info?.mint === mintAddress
            })
            if (match) {
                const info = (match.account.data as any).parsed.info
                balances[addr] = info.tokenAmount.amount as string
                decimals = info.tokenAmount.decimals as number
            } else {
                balances[addr] = '0'
            }
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
