import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getWalletHoldings } from "@/lib/pumpfun/wallet-holdings";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const walletAddress = url.searchParams.get('walletAddress');
  const mintAddress   = url.searchParams.get('mintAddress');

  if (!walletAddress || !mintAddress) {
    return NextResponse.json({ error: 'walletAddress and mintAddress are required' }, { status: 400 });
  }

  try {
    const holdings = await getWalletHoldings(new PublicKey(walletAddress));
    if (!holdings) {
      return NextResponse.json({ error: 'Failed to fetch holdings' }, { status: 500 });
    }

    const holding = holdings.find(h => h.mint === mintAddress);
    const balance = holding?.balance ?? 0;

    return NextResponse.json({ balance }, { status: 200 });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
