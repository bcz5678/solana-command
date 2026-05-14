import { LaunchType } from '@/components/tokens/launch/types';


type WalletTrade= {
    walletId: number
    tradeType: string, 
    buyAmountInSOL: number
}

export class BuyerConfig {
    devWalletId: number;
    launchType: LaunchType;
    walletCount: number;
    totalSOL: number;
    tokensTotal: number;
    percentOfSupply: number;
    marketCap: number;
    walletTrades: WalletTrade[];

    constructor(
        devWalletId: number,
        launchType: LaunchType,
        walletCount: number,
        totalSOL: number,
        tokensTotal: number,
        percentOfSupply: number,
        marketCap: number,
        walletTrades: WalletTrade[]
    ) {
        this.devWalletId = devWalletId;
        this.launchType = launchType;
        this.walletCount = walletCount;
        this.totalSOL = totalSOL;
        this.tokensTotal = tokensTotal;
        this.percentOfSupply = percentOfSupply;
        this.marketCap = marketCap;
        this.walletTrades = walletTrades;
    }

    copyWith(overrides: Partial<Omit<BuyerConfig, 'copyWith'>>): BuyerConfig {
        return new BuyerConfig(
            overrides.devWalletId      ?? this.devWalletId,
            overrides.launchType       ?? this.launchType,
            overrides.walletCount      ?? this.walletCount,
            overrides.totalSOL         ?? this.totalSOL,
            overrides.tokensTotal      ?? this.tokensTotal,
            overrides.percentOfSupply  ?? this.percentOfSupply,
            overrides.marketCap        ?? this.marketCap,
            overrides.walletTrades     ?? this.walletTrades,
        )
    }


    clearWalletList(): void {
        this.walletCount = 0;
        this.totalSOL = 0;
        this.tokensTotal = 0;
        this.percentOfSupply = 0;
        this.marketCap = 0;
        this.walletTrades.length = 0;
    }

    updateWalletList(walletID: number, newAmount: number, tradeType: string): void {
        const walletListIndex: number = this.getWalletListIndex(walletID);
        
        if(walletListIndex != -1) {
            if(newAmount == 0 || newAmount == null) {
                this.walletCount -=1;
                this.walletTrades.splice(walletListIndex, 1);
            }else {
                this.walletTrades[walletListIndex].buyAmountInSOL = newAmount;
            }
        } else {
            this.walletCount += 1;

            const newWalletTrade: WalletTrade = {
                walletId: walletID,
                tradeType: tradeType,
                buyAmountInSOL: newAmount,
            } 
            this.walletTrades.push(newWalletTrade);
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

}
