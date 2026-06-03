import { NextRequest, NextResponse } from "next/server";
import BN from 'bn.js';
import { PublicKey } from "@solana/web3.js";

import { getTokenSnapshot } from '@/lib/pumpfun/token-snapshot';
import { TokenSnapshot } from '@/lib/types/token-pumpfun';


export async function GET(request: NextRequest) {       
    const url = new URL(request.url);
    const mintAddress = url.searchParams.get('mintAddress');
   
    try{
        
        if(mintAddress != null){
            const tokenSnapshotResponse: TokenSnapshot | null = await getTokenSnapshot(new PublicKey(mintAddress)); 
            if (tokenSnapshotResponse != null) {
                return NextResponse.json({
                    message: "Token Snapshot",
                    body: {
                        snapshot: tokenSnapshotResponse,
                    }
                },{
                    status: 200    
                });
            } else {
                return NextResponse.json({ error: 'Unable to return snapshot' }, { status: 400 })
            }
        } else {
           return NextResponse.json({ error: 'Invalid Request' }, { status: 400 })
        }
       

    } catch {
        return NextResponse.json({ error: 'Invalid Request' }, { status: 400 })
    }
}







