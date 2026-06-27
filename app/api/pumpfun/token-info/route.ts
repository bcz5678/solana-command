import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";

import { getTokenPreview } from '@/lib/pumpfun/token-snapshot';
import { TokenPreview } from '@/lib/types/token-pumpfun';


export async function GET(request: NextRequest) {
    const url = new URL(request.url);
    const mintAddress = url.searchParams.get('mintAddress');

    try{

        if(mintAddress != null){
            const preview: TokenPreview | null = await getTokenPreview(new PublicKey(mintAddress));
            if (preview != null) {
                return NextResponse.json({
                    message: "Token Preview",
                    body: {
                        preview,
                    }
                },{
                    status: 200
                });
            } else {
                return NextResponse.json({ error: 'Unable to return token preview' }, { status: 400 })
            }
        } else {
           return NextResponse.json({ error: 'Invalid Request' }, { status: 400 })
        }


    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Invalid Request' },
            { status: 400 },
        )
    }
}
