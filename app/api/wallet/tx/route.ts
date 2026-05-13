import { handleError, initializeConnection, parseAndValidateAddress } from '@/app/api/utils/helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {

    console.log('api/wallet/tx/route -> GET -> entry ');

    const url = new URL(request.url);
    const walletAddress = url.searchParams.get('walletAddress');
    const limit = 20; // url.searchParams.get('limit');
    try {

        console.log('api/wallet/tx/route -> GET -> try ');

        const publicKey = await parseAndValidateAddress(walletAddress);
        
        console.log(`api/wallet/tx/route -> GET -> publicKey: ${publicKey}`);
        
        const connection = initializeConnection();
        
        console.log(`api/wallet/tx/route -> GET -> connection: ${connection}`);
        
        const txIds = await connection.getSignaturesForAddress(publicKey, { limit });
    
        console.log(`api/wallet/tx/route -> GET -> txIds: ${txIds}`);


        return new Response(JSON.stringify({ txIds }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      } catch (error) {
        return handleError(error);
      }
}