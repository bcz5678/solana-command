import { solStringToLamports } from '@/lib/lamports';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const url = new URL(request.url);
    const devWalletAddress = url.searchParams.get('devWalletAddress');
    const amountSOLStr = url.searchParams.get('amountSOL') ?? '0';
    const lamports = solStringToLamports(amountSOLStr);


    





}