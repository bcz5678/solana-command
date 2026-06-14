'use client'

import { useState, useRef } from 'react'
import { X, Loader2 } from 'lucide-react'

type AssetResult = Record<string, unknown>

export default function CloneTokenForm() {
    const [mintAddress, setMintAddress] = useState('')
    const [loading, setLoading]         = useState(false)
    const [metadata, setMetadata]       = useState<AssetResult | null>(null)
    const [error, setError]             = useState<string | null>(null)
    const inputRef                      = useRef<HTMLInputElement>(null)

    function handleClear() {
        setMintAddress('')
        setMetadata(null)
        setError(null)
        inputRef.current?.focus()
    }

    async function handleGetMetadata() {
        const mint = mintAddress.trim()
        if (!mint) return
        setLoading(true)
        setMetadata(null)
        setError(null)
        try {
            const res = await fetch(`/api/tokens/clone?mintAddress=${encodeURIComponent(mint)}`)
            const body = await res.json()
            if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
            setMetadata(body.result ?? null)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="flex flex-col gap-3 w-full">
            <p className="text-xs text-muted-foreground">
                Paste a token mint address to fetch its on-chain metadata
            </p>

            {/* Input row */}
            <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center gap-1.5 rounded-lg border border-input bg-transparent px-3 h-9 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
                    <input
                        ref={inputRef}
                        value={mintAddress}
                        onChange={(e) => { setMintAddress(e.target.value); setError(null) }}
                        onKeyDown={(e) => e.key === 'Enter' && handleGetMetadata()}
                        placeholder="Paste mint address…"
                        className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground min-w-0 font-mono"
                    />
                    {mintAddress && (
                        <button
                            type="button"
                            onClick={handleClear}
                            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                            aria-label="Clear"
                        >
                            <X className="size-3.5" />
                        </button>
                    )}
                </div>

                <button
                    type="button"
                    onClick={handleGetMetadata}
                    disabled={!mintAddress.trim() || loading}
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 h-9 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {loading && <Loader2 className="size-3.5 animate-spin" />}
                    Get Metadata
                </button>
            </div>

            {/* Error */}
            {error && (
                <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
            )}

            {/* Result */}
            {metadata && (
                <div className="rounded-lg border border-border bg-muted/40 p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Asset Metadata</p>
                    <pre className="text-xs text-foreground whitespace-pre-wrap break-all font-mono">
                        {JSON.stringify(metadata, null, 2)}
                    </pre>
                </div>
            )}
        </div>
    )
}
