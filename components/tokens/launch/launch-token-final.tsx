'use client'

import { LaunchResult } from './launch-token'

type Props = {
    result: LaunchResult
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex flex-col gap-0.5">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-sm font-mono break-all text-foreground">{value}</p>
        </div>
    )
}

export default function LaunchTokenFinal({ result }: Props) {
    const isError   = !!result.error
    const isPartial = !!result.partial

    return (
        <div className="flex flex-col gap-4 w-full">

            {/* Status banner */}
            <div className={[
                'rounded-xl border px-4 py-3 text-sm font-medium',
                isError
                    ? 'border-red-500/40 bg-red-500/10 text-red-400'
                    : isPartial
                    ? 'border-yellow-500/40 bg-yellow-500/10 text-yellow-400'
                    : 'border-green-500/40 bg-green-500/10 text-green-400',
            ].join(' ')}>
                {result.message}
            </div>

            {/* Error detail */}
            {isError && result.error && (
                <div className="rounded-xl border border-border bg-card p-4">
                    <Row label="Error" value={result.error} />
                </div>
            )}

            {/* Launch details */}
            {!isError && (
                <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border pb-2">
                        Launch Details
                    </h3>

                    {result.tokenName   && <Row label="Token Name"    value={result.tokenName} />}
                    {result.tokenSymbol && <Row label="Token Symbol"  value={result.tokenSymbol} />}
                    {result.mintAddress && <Row label="Mint Address"  value={result.mintAddress} />}
                    {result.signature   && <Row label="TX Signature"  value={result.signature} />}
                </div>
            )}

            {/* External links */}
            {(result.explorerUrl || result.pumpUrl) && (
                <div className="flex gap-3">
                    {result.explorerUrl && (
                        <a
                            href={result.explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 text-center px-4 py-2.5 text-sm font-semibold rounded-xl border border-border hover:bg-muted transition-colors"
                        >
                            View on Solscan
                        </a>
                    )}
                    {result.pumpUrl && (
                        <a
                            href={result.pumpUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 text-center px-4 py-2.5 text-sm font-semibold rounded-xl bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                        >
                            View on Pump.fun
                        </a>
                    )}
                </div>
            )}
        </div>
    )
}
