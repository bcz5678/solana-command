export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const url = new URL(request.url);
    const devWalletAddress = url.searchParams.get('devWalletAddress');
    const amountSOL = parseFloat(url.searchParams.get('amountSOL') ?? '0');
    const lamports = Math.round(amountSOL * 1_000_000_000);


    





}