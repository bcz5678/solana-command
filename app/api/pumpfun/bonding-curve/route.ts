import { solStringToLamports } from '@/lib/lamports';

import { handleError, initializeQuickNodeSolana, initializeConnection, parseAndValidateAddress } from '@/app/api/utils/helpers';
import { Keypair, PublicKey } from "@solana/web3.js";
import { 
    PUMP_SDK, 
    OnlinePumpSdk, 
    newBondingCurve,
    getBuyTokenAmountFromSolAmount,
    getSellSolAmountFromTokenAmount,
    bondingCurveMarketCap 
} from '@pump-fun/pump-sdk';
import { LaunchConfig } from '@/components/tokens/launch/launch-config-class';

import bs58 from 'bs58';

export const dynamic = 'force-dynamic';


export enum BongCurveRequestType {
    initial             = "initial",
    getMarketCap        = "getMarketCap",
    getTokensFromSOL    = "getTokensFromSOL",
    getMarketCapFromSOL = "getMarketCapFromSOL",
}


export interface BondingCurveRequest {
    type: BondingCurveRequest[],

}





    // initialize connection
const quicknodeSolana = initializeQuickNodeSolana();
const onlineSdk = new OnlinePumpSdk(quicknodeSolana.connection);

const global = await onlineSdk.fetchGlobal();

export async function GET(request: Request) {
    console.log('api/pumpfun/bondingcurve/route -> GET -> entry ');

    const url = new URL(request.url);

    try {

        console.log(`api/pumpfun/bondingcurve/route -> GET ->  global : ${ global } `);

        const initialBondingCurve = newBondingCurve(global);

        console.log(`api/pumpfun/bondingcurve/route -> GET -> initialBondingCurve: ${ initialBondingCurve } `);

        // Calculate initial market cap
        const marketCap = bondingCurveMarketCap({
            mintSupply: initialBondingCurve.tokenTotalSupply,
            virtualQuoteReserves: initialBondingCurve.virtualQuoteReserves,
            virtualTokenReserves: initialBondingCurve.virtualTokenReserves,
        });

        console.log(`api/pumpfun/bondingcurve/route -> GET -> marketCap: ${ marketCap } `);

        return new Response(JSON.stringify({marketCap }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
        });
    } catch (error) {
        return handleError(error);
    }
}