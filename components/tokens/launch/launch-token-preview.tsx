'use client'

import { BuyerConfig } from './buyer-config-class'
import { lamportsBNToSolDisplay } from '@/lib/lamports'
import { TokenDTO } from '@/app/db/models/wallet'

type Props = {
    token: TokenDTO | null
    buyerConfig: BuyerConfig
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

export default function LaunchTokenPreview({ token, buyerConfig }: Props) {
    const totalSOL = lamportsBNToSolDisplay(buyerConfig.totalSOLInLamports)
    const buyerWalletCount = buyerConfig.walletCount
    const totalWallets = buyerWalletCount + 1

    return (
        <div className="flex flex-col gap-4 w-full">

            {/* Token Meta */}
            <SubCard title="Token Meta">
                <div className="grid grid-cols-2 gap-6">
                    <div className="flex flex-col gap-3">
                        <Field label="Token Name" value={token?.name ?? '—'} />
                        <Field label="Token Symbol" value={token?.symbol ?? '—'} />
                        <Field label="Description" value={token?.description ?? '—'} />
                    </div>
                    <div className="flex items-center justify-center">
                        <div className="size-24 rounded-xl bg-muted border border-border flex items-center justify-center text-2xl font-bold text-muted-foreground">
                            {token?.symbol?.slice(0, 1) ?? '?'}
                        </div>
                    </div>
                </div>
            </SubCard>

            {/* CA Configuration */}
            <SubCard title="CA Configuration">
                <Field label="Contract Address" value={`${token?.contract_address ?? '-'}`} dim />
            </SubCard>

            {/* Buyer Configuration */}
            <SubCard title="Buyer Configuration">
                <div className="flex flex-col gap-3">
                    <Field label="Launch Type" value={buyerConfig.launchType.toString()} />
                    <Field label="Jito Tip" value="Not implemented" dim />
                    <Field
                        label="Number of Wallets"
                        value={`${totalWallets} (1 dev + ${buyerWalletCount} buyer${buyerWalletCount !== 1 ? 's' : ''})`}
                    />
                    <Field
                        label="Purchasing a Total of"
                        value={`${totalSOL} SOL of ${token?.name ?? '—'}`}
                    />
                    <Field label="Token Amount" value="Not implemented" dim />
                    <Field label="Percentage of Total Supply" value="Not implemented" dim />
                </div>
            </SubCard>

        </div>
    )
}
