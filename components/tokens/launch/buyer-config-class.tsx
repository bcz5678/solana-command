import { LaunchType } from '@/components/tokens/launch/types';
import BN from 'bn.js';


type WalletTrade= {
    walletId: number
    tradeType: string
    buyAmountInSOL: BN
    tokensAmountHeld: BN | null
    percentOfSupplyHeld: BN | null
    marketCapAtBuy: BN | null
}

export class BuyerConfig {
    devWalletId: number;
    launchType: LaunchType;
    walletCount: number;
    totalSOLInLamports: BN;
    tokensTotal: BN;
    percentOfSupply: BN;
    marketCap: BN;
    walletTrades: WalletTrade[];

    constructor(
        devWalletId: number,
        launchType: LaunchType,
        walletCount: number,
        totalSOLInLamports: BN,
        tokensTotal: BN,
        percentOfSupply: BN,
        marketCap: BN,
        walletTrades: WalletTrade[]
    ) {
        this.devWalletId = devWalletId;
        this.launchType = launchType;
        this.walletCount = walletCount;
        this.totalSOLInLamports = totalSOLInLamports
        this.tokensTotal = tokensTotal;
        this.percentOfSupply = percentOfSupply;
        this.marketCap = marketCap;
        this.walletTrades = walletTrades;
    }

    toJSON(): {
        devWalletId: number;
        launchType: LaunchType;
        walletCount: number;
        totalSOLInLamports: string;
        tokensTotal: string;
        percentOfSupply: string;
        marketCap: string;
        walletTrades: {
            walletId: number;
            tradeType: string;
            buyAmountInSOL: string;
            tokensAmountHeld: string | null;
            percentOfSupplyHeld: string | null;
            marketCapAtBuy: string | null;
        }[];
    } {
        return {
            devWalletId: this.devWalletId,
            launchType: this.launchType,
            walletCount: this.walletCount,
            totalSOLInLamports: this.totalSOLInLamports.toString(),
            tokensTotal: this.tokensTotal.toString(),
            percentOfSupply: this.percentOfSupply.toString(),
            marketCap: this.marketCap.toString(),
            walletTrades: this.walletTrades.map(t => ({
                walletId: t.walletId,
                tradeType: t.tradeType,
                buyAmountInSOL: t.buyAmountInSOL.toString(),
                tokensAmountHeld: t.tokensAmountHeld != null ? t.tokensAmountHeld.toString() : null,
                percentOfSupplyHeld: t.percentOfSupplyHeld != null ? t.percentOfSupplyHeld.toString() : null,
                marketCapAtBuy: t.marketCapAtBuy != null ? t.marketCapAtBuy.toString() : null,
            })),
        };
    }

    static fromJSON(json: {
        devWalletId: number;
        launchType: LaunchType;
        walletCount: number;
        totalSOLInLamports: string;
        tokensTotal: string;
        percentOfSupply: string;
        marketCap: string;
        walletTrades: {
            walletId: number;
            tradeType: string;
            buyAmountInSOL: string;
            tokensAmountHeld: string | null;
            percentOfSupplyHeld: string | null;
            marketCapAtBuy: string | null;
        }[];
    }): BuyerConfig {
        return new BuyerConfig(
            json.devWalletId,
            json.launchType,
            json.walletCount,
            new BN(json.totalSOLInLamports),
            new BN(json.tokensTotal),
            new BN(json.percentOfSupply),
            new BN(json.marketCap),
            json.walletTrades.map(t => ({
                walletId: t.walletId,
                tradeType: t.tradeType,
                buyAmountInSOL: new BN(t.buyAmountInSOL),
                tokensAmountHeld: t.tokensAmountHeld != null ? new BN(t.tokensAmountHeld) : null,
                percentOfSupplyHeld: t.percentOfSupplyHeld != null ? new BN(t.percentOfSupplyHeld) : null,
                marketCapAtBuy: t.marketCapAtBuy != null ? new BN(t.marketCapAtBuy) : null,
            }))
        );
    }

    copyWith(overrides: Partial<Omit<BuyerConfig, 'copyWith'>>): BuyerConfig {
        return new BuyerConfig(
            overrides.devWalletId      ?? this.devWalletId,
            overrides.launchType       ?? this.launchType,
            overrides.walletCount      ?? this.walletCount,
            overrides.totalSOLInLamports         ?? this.totalSOLInLamports,
            overrides.tokensTotal      ?? this.tokensTotal,
            overrides.percentOfSupply  ?? this.percentOfSupply,
            overrides.marketCap        ?? this.marketCap,
            overrides.walletTrades     ?? this.walletTrades,
        )
    }


    clearWalletList(): void {
        this.walletCount = 0;
        this.totalSOLInLamports = new BN(0);
        this.tokensTotal = new BN(0);
        this.percentOfSupply = new BN(0);
        this.marketCap = new BN(0);
        this.walletTrades.length = 0;
    }

    updateWalletList(walletID: number, newAmount: BN, tradeType: string): void {
        const walletListIndex: number = this.getWalletListIndex(walletID);
        
        if(walletListIndex != -1) {

            //Wallet in this.walletTrades and the amount has been cleared
            if(newAmount.isZero() || newAmount == null) {


                //Remove wallet from list
                this.walletTrades.splice(walletListIndex, 1);

                //Loop through updated walletTrades list and recalculate Total SOL
                this.totalSOLInLamports = this._calculateTotalSOLBuyAmount();

                //
                this.walletCount = this.walletTrades.length;


            }else {
                //wallet in this.walletTrades, adusting SOL amount
                this.walletTrades[walletListIndex].buyAmountInSOL = newAmount;

                //Loop through walletTrades list and recalculate Total SOL
                this.totalSOLInLamports = this._calculateTotalSOLBuyAmount();
            }
        } else {
            if (newAmount.isZero() || newAmount == null) return;

            //wallet not in walletTrades, adding to walletCount
            this.walletCount += 1;

            //building new WalletTrade and adding to this.walletTrades 
            const newWalletTrade: WalletTrade = {
                walletId: walletID,
                tradeType: tradeType,
                buyAmountInSOL: newAmount,
                tokensAmountHeld:  null,
                percentOfSupplyHeld: null,
                marketCapAtBuy: null
            } 
            this.walletTrades.push(newWalletTrade);


            //Loop through updated walletTrades list and recalculate Total SOL
            this.totalSOLInLamports = this._calculateTotalSOLBuyAmount();
        }
    }


    getWalletListIndex(walletId: number): number {
        let isInList: number = -1;
        
        for(const [index, element] of this.walletTrades.entries()) {
            if (walletId == element.walletId) {
                isInList = index;
                break
            }
        }

        return isInList;
    }

    _calculateTotalSOLBuyAmount(): BN {
        let runningTotalSOL:BN = new BN(0);

        for(const [index, walletTrade] of this.walletTrades.entries()) {
            runningTotalSOL.iadd(walletTrade.buyAmountInSOL);
        }

        return runningTotalSOL;
    }

}
