import { NextRequest, NextResponse } from "next/server";
import BN from 'bn.js';

import { getTokenSnapshot } from '@/lib/pumpfun/token-snapshot';
import { TokenSnapshot } from '@/lib/types/token-pumpfun';

export async function POST(request: NextRequest) {
   

    try{
        const body = await request.json();
        const tokenSnapshotResponse: TokenSnapshot | null = await getTokenSnapshot(body.mintAddress); 
     
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

    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
}







