'use client'

import { LaunchConfig } from './launch-config-class'
import { lamportsBNToSolDisplay } from '@/lib/lamports'

type Props = {
    launchConfig: LaunchConfig
    onLaunch?: () => void
}


function Field({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
    return (
        <div className="flex flex-col gap-0.5">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-sm font-mono ${dim ? 'text-muted-foreground italic' : 'text-foreground'}`}>
                {value}
            </p>
        </div>
    )
}

function SubCard({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border pb-2">
                {title}
            </h3>
            {children}
        </div>
    )
}

export default function LaunchTokenPreview({ launchConfig, onLaunch }: Props) {
    const totalSOL = lamportsBNToSolDisplay(launchConfig.totalSOLInLamports)
    const buyerWalletCount = launchConfig.walletTrades.length
    const totalWallets = launchConfig.walletTrades.length + 1

    return (
        <div className="flex flex-col gap-4 w-full">

            {/* launchConfig.token Meta */}
            <SubCard title="launchConfig.token Meta">
                <div className="grid grid-cols-2 gap-6">
                    <div className="flex flex-col gap-3">
                        <Field label="launchConfig.token Name" value={launchConfig.token?.token_name ?? '—'} />
                        <Field label="launchConfig.token Symbol" value={launchConfig.token?.token_symbol ?? '—'} />
                        <Field label="Description" value={launchConfig.token?.description ?? '—'} />
                    </div>
                    <div className="flex items-center justify-center">
                        <div className="size-24 rounded-xl bg-muted border border-border overflow-hidden flex items-center justify-center text-2xl font-bold text-muted-foreground">
                            {launchConfig.token?.logo_url
                                ? <img src={launchConfig.token.logo_url} alt={launchConfig.token.token_symbol} className="size-full object-cover" />
                                : (launchConfig.token?.token_symbol?.slice(0, 1) ?? '?')
                            }
                        </div>
                    </div>
                </div>
            </SubCard>

            {/* CA Configuration */}
            <SubCard title="CA Configuration">
                <Field label="Contract Address" value={`${launchConfig.token?.mint_public_key ?? '-'}`} dim />
            </SubCard>

            {/* Buyer Configuration */}
            <SubCard title="Buyer Configuration">
                <div className="flex flex-col gap-3">
                    <Field label="Launch Type" value={launchConfig.launchType.toString()} />
                    <Field label="Jito Tip" value="Not implemented" dim />
                    <Field
                        label="Number of Wallets"
                        value={`${totalWallets} (1 dev + ${buyerWalletCount} buyer${buyerWalletCount !== 1 ? 's' : ''})`}
                    />
                    <Field
                        label="Purchasing a Total of"
                        value={`${totalSOL} SOL of ${launchConfig.token?.token_name ?? '—'}`}
                    />
                    <Field label="Total Token Amount" value="Not implemented" dim />
                    <Field label="Percentage of Total Supply" value="Not implemented" dim />
                </div>
            </SubCard>

            {onLaunch && (
                <button
                    onClick={onLaunch}
                    className="w-full px-4 py-2.5 text-sm font-semibold rounded-xl bg-blue-500 text-white hover:bg-blue-600 active:bg-blue-700 transition-colors"
                >
                    Launch
                </button>
            )}
        </div>
    )
}
