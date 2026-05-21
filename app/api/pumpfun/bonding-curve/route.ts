import { solStringToLamports } from '@/lib/lamports';

import { handleError, initializeQuickNodeSolana } from '@/app/api/utils/helpers';
import {
    OnlinePumpSdk,
    newBondingCurve,
    getBuyTokenAmountFromSolAmount,
    getSellSolAmountFromTokenAmount,
    bondingCurveMarketCap
} from '@pump-fun/pump-sdk';
import BN from 'bn.js';

export const dynamic = 'force-dynamic';


export enum BondingCurveRequestType {
    initial             = "initial",
    getMarketCap        = "getMarketCap",
    getTokensFromSOL    = "getTokensFromSOL",
    getMarketCapFromSOL = "getMarketCapFromSOL",
}

export interface BondingCurveRequest {
    type: string[];
    solAmount?: string;
    tokenAmount?: string;
}

function getBondingCurveRequestTypes(requestList: string[]): BondingCurveRequestType[] {
    const validTypes = new Set(Object.values(BondingCurveRequestType));
    return requestList.filter((s): s is BondingCurveRequestType =>
        validTypes.has(s as BondingCurveRequestType)
    );
}


const quicknodeSolana = initializeQuickNodeSolana();
const onlineSdk = new OnlinePumpSdk(quicknodeSolana.connection);
const global = await onlineSdk.fetchGlobal();

export async function POST(request: Request) {
    console.log('api/pumpfun/bondingcurve/route -> POST -> entry');

    try {
        const body: BondingCurveRequest = await request.json();
        const requestTypes = getBondingCurveRequestTypes(body.type);

        const bondingCurve = newBondingCurve(global);
        const result: Record<string, unknown> = {};

        for (const type of requestTypes) {
            switch (type) {
                case BondingCurveRequestType.initial:
                    result.initial = bondingCurve;
                    break;

                case BondingCurveRequestType.getMarketCap:
                    result.marketCap = bondingCurveMarketCap({
                        mintSupply: bondingCurve.tokenTotalSupply,
                        virtualQuoteReserves: bondingCurve.virtualQuoteReserves,
                        virtualTokenReserves: bondingCurve.virtualTokenReserves,
                    });
                    break;

                case BondingCurveRequestType.getTokensFromSOL: {
                    const solLamports = solStringToLamports(body.solAmount ?? '0');
                    result.tokensFromSOL = getBuyTokenAmountFromSolAmount({
                        global,
                        feeConfig: null,
                        mintSupply: null,
                        bondingCurve,
                        amount: solLamports,
                    });

                    console.log(`api/pumpfun/bondingcurve/route -> getTokensFromSOL: ${result.tokensFromSOL}`);
                    break;
                }

                case BondingCurveRequestType.getMarketCapFromSOL: {
                    const solLamports = new BN(solStringToLamports(body.solAmount ?? '0'));
                    const tokensBought = getBuyTokenAmountFromSolAmount({
                        global,
                        feeConfig: null,
                        mintSupply: null,
                        bondingCurve,
                        amount: solLamports,
                    });
                    result.marketCapFromSOL = bondingCurveMarketCap({
                        mintSupply: bondingCurve.tokenTotalSupply.sub(tokensBought),
                        virtualQuoteReserves: bondingCurve.virtualQuoteReserves.add(solLamports),
                        virtualTokenReserves: bondingCurve.virtualTokenReserves.sub(tokensBought),
                    });

                    console.log(`api/pumpfun/bondingcurve/route -> marketCapFromSOL: ${result.marketCapFromSOL}`);

                    break;
                }
            }
        }

        return new Response(JSON.stringify(result), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
        });
    } catch (error) {
        return handleError(error);
    }
}
