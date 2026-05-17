import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { handleError, initializeQuickNodeSolana, parseAndValidateAddress } from '@/app/api/utils/helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    console.log('api/wallet/balance/route -> GET -> entry ');

    const url = new URL(request.url);
    const walletAddress = url.searchParams.get('walletAddress');
    try {
        const publicKey = await parseAndValidateAddress(walletAddress); 
        const quicknodeSolana = initializeQuickNodeSolana();
        const slot = await quicknodeSolana.connection.getSlot();
        const balance = await quicknodeSolana.connection.getBalance(publicKey);
        const solBalance = balance / LAMPORTS_PER_SOL;

        return new Response(JSON.stringify({ solBalance }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
        });
    } catch (error) {
        return handleError(error);
    }
}