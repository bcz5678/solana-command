import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { handleError, initializeConnection, parseAndValidateAddress } from '@/app/api/utils/helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    console.log('api/wallet/balance/route -> GET -> entry ');

    const url = new URL(request.url);
    const walletAddress = url.searchParams.get('walletAddress');
    try {

        console.log('api/wallet/balance/route -> GET -> try ');

        const publicKey = await parseAndValidateAddress(walletAddress);
        
        console.log(`api/wallet/balance/route -> GET -> publicKey: ${publicKey} `);
        
        const connection = initializeConnection();

        const slot = await connection.getSlot();

        console.log(`api/wallet/balance/route -> GET -> connection.getSlot: ${slot} `);

        const balance = await connection.getBalance(publicKey);

        console.log(`api/wallet/balance/route -> GET -> balance: ${balance}`);

        const solBalance = balance / LAMPORTS_PER_SOL;

        console.log(`api/wallet/balance/route -> GET -> solBalance: ${solBalance}`);

        return new Response(JSON.stringify({ solBalance }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
        });
    } catch (error) {
        return handleError(error);
    }
}