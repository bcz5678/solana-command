import { WalletModelDTO }  from '@/app/db/models/wallet';
import { LaunchType } from '@/components/tokens/launch/types';

type WalletTrade= {
    wallet: WalletModelDTO
    tradeType: 'buy' | 'sell' 
    buyAmountInSOL: number
}

export class BuyerConfig{
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
}
