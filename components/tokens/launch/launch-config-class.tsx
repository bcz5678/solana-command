import { LaunchType } from '@/components/tokens/launch/types';
import { TokenMint } from '@/lib/types/token-mint';
import { WalletTradeDTO } from '@/lib/types/wallet';
import BN from 'bn.js';


export class LaunchConfig {
    launchType: LaunchType;
    token: TokenMint | null;
    totalSOLInLamports: BN;
    tokensTotal: BN;
    percentOfSupply: BN;
    marketCap: BN;
    walletTrades: WalletTradeDTO[];

    constructor(
        launchType: LaunchType,
        token: TokenMint | null,
        totalSOLInLamports: BN,
        tokensTotal: BN,
        percentOfSupply: BN,
        marketCap: BN,
        walletTrades: WalletTradeDTO[]
    ) {
        this.launchType = launchType;
        this.token = token;
        this.totalSOLInLamports = totalSOLInLamports
        this.tokensTotal = tokensTotal;
        this.percentOfSupply = percentOfSupply;
        this.marketCap = marketCap;
        this.walletTrades = walletTrades;
    }

    toJSON(): {
        launchType: LaunchType;
        token: TokenMint | null;
        totalSOLInLamports: string;
        tokensTotal: string;
        percentOfSupply: string;
        marketCap: string;
        walletTrades: {
            walletId: string;
            tradeType: string;
            buyAmountInSOL: string;
            tokensAmountHeld: string | null;
            percentOfSupplyHeld: string | null;
            marketCapAtBuy: string | null;
        }[];
    } {
        return {
            launchType: this.launchType,
            token: this.token,
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
        launchType: LaunchType;
        token: TokenMint,
        totalSOLInLamports: string;
        tokensTotal: string;
        percentOfSupply: string;
        marketCap: string;
        walletTrades: {
            walletId: string;
            tradeType: string;
            buyAmountInSOL: string;
            tokensAmountHeld: string | null;
            percentOfSupplyHeld: string | null;
            marketCapAtBuy: string | null;
        }[];
    }): LaunchConfig {
        return new LaunchConfig(
            json.launchType,
            json.token,
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

    copyWith(overrides: Partial<Omit<LaunchConfig, 'copyWith'>>): LaunchConfig {
        return new LaunchConfig(
            overrides.launchType       ?? this.launchType,
            overrides.token            ?? this.token,
            overrides.totalSOLInLamports         ?? this.totalSOLInLamports,
            overrides.tokensTotal      ?? this.tokensTotal,
            overrides.percentOfSupply  ?? this.percentOfSupply,
            overrides.marketCap        ?? this.marketCap,
            overrides.walletTrades     ?? this.walletTrades,
        )
    }


    /** Pure — returns a new LaunchConfig with an empty wallet list, doesn't mutate this one. */
    clearWalletList(): LaunchConfig {
        return this.copyWith({
            walletTrades:       [],
            totalSOLInLamports: new BN(0),
            tokensTotal:        new BN(0),
            percentOfSupply:    new BN(0),
            marketCap:          new BN(0),
        });
    }

    /**
     * Pure — returns a new LaunchConfig with `walletID`'s buy amount set (added,
     * updated, or removed if zeroed), doesn't mutate this.walletTrades in place.
     * Mutating a shared array here previously risked stale/duplicate entries
     * across renders (React state must be treated as immutable) — that's the
     * class of bug that let a single dev-wallet buy show up twice.
     */
    updateWalletList(walletID: string, newAmount: BN, tradeType: string): LaunchConfig {
        const walletListIndex: number = this.getWalletListIndex(walletID);
        let walletTrades: WalletTradeDTO[];

        if (walletListIndex !== -1) {
            if (newAmount.isZero() || newAmount == null) {
                // Wallet in the list, amount cleared — remove it.
                walletTrades = this.walletTrades.filter((_, i) => i !== walletListIndex);
            } else {
                // Wallet in the list — adjust its SOL amount.
                walletTrades = this.walletTrades.map((t, i) =>
                    i === walletListIndex ? { ...t, buyAmountInSOL: newAmount } : t
                );
            }
        } else {
            if (newAmount.isZero() || newAmount == null) return this;

            const newWalletTrade: WalletTradeDTO = {
                walletId: walletID,
                tradeType: tradeType,
                buyAmountInSOL: newAmount,
                tokensAmountHeld: null,
                percentOfSupplyHeld: null,
                marketCapAtBuy: null,
            };
            walletTrades = [...this.walletTrades, newWalletTrade];
        }

        return this.copyWith({
            walletTrades,
            totalSOLInLamports: LaunchConfig.sumBuyAmounts(walletTrades),
        });
    }

    getWalletListIndex(walletId: string): number {
        let isInList: number = -1;

        for(const [index, element] of this.walletTrades.entries()) {
            if (walletId == element.walletId) {
                isInList = index;
                break
            }
        }

        return isInList;
    }

    static sumBuyAmounts(walletTrades: WalletTradeDTO[]): BN {
        let runningTotalSOL: BN = new BN(0);

        for (const walletTrade of walletTrades) {
            runningTotalSOL = runningTotalSOL.add(walletTrade.buyAmountInSOL);
        }

        return runningTotalSOL;
    }

}
