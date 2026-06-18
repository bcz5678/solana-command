'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import {
    Combobox,
    ComboboxInput,
    ComboboxContent,
    ComboboxList,
    ComboboxItem,
} from '@/components/ui/combobox'
import CreateTokenForm, { CreateTokenFormInput, CreateTokenFormHandle } from '@/components/tokens/create/create-token-form'
import SourceCoinPanel, { clonableCoinFromTokenMint, clonableCoinFromOnChainAsset } from '@/components/tokens/clone/source-coin-panel'
import { TokenMint, TokenMetaDTO } from '@/lib/types/token-mint'

type OnChainAsset = { metaData: Record<string, unknown> | null; uriData: Partial<TokenMetaDTO> | null }
type TokenOption = { value: string; label: string; token: TokenMint }

interface Props {
    onSubmit: (data: CreateTokenFormInput, logoFile: File, bannerFile: File | null) => Promise<void>
    isSubmitting?: boolean
}

export default function CloneTokenForm({ onSubmit, isSubmitting = false }: Props) {
    // ── DB coin picker ──────────────────────────────────────────
    const [tokens, setTokens]                 = useState<TokenMint[]>([])
    const [selectedOption, setSelectedOption] = useState<TokenOption | null>(null)
    const [inputValue, setInputValue]         = useState('')

    // ── On-chain mint-address lookup ─────────────────────────────
    const [loading, setLoading]       = useState(false)
    const [onChainAsset, setOnChainAsset] = useState<OnChainAsset | null>(null)
    const [error, setError]           = useState<string | null>(null)

    const formRef = useRef<CreateTokenFormHandle>(null)

    useEffect(() => {
        fetch('/api/token-mint/explorer?status=all')
            .then(r => r.json())
            .then(data => setTokens(data?.tokens ?? []))
            .catch(err => console.error('[clone] failed to load tokens', err))
    }, [])

    const selectedToken = selectedOption?.token ?? null

    const options: TokenOption[] = useMemo(
        () => tokens.map(t => ({ value: t.id, label: `${t.token_symbol} — ${t.token_name}`, token: t })),
        [tokens]
    )

    const filteredOptions = useMemo(() => {
        const q = inputValue.trim().toLowerCase()
        if (!q || selectedOption) return options
        return options.filter(o =>
            o.label.toLowerCase().includes(q) ||
            o.token.mint_public_key?.toLowerCase().includes(q)
        )
    }, [options, inputValue, selectedOption])

    async function handleGetMetadata() {
        const mint = inputValue.trim()
        if (!mint) return
        setLoading(true)
        setOnChainAsset(null)
        setError(null)
        try {
            const res = await fetch(`/api/tokens/clone?mintAddress=${encodeURIComponent(mint)}`)
            const body = await res.json()
            if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
            setOnChainAsset({ metaData: body.metaData ?? null, uriData: body.uriData ?? null })
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error')
        } finally {
            setLoading(false)
        }
    }

    const onChainCoin = onChainAsset
        ? clonableCoinFromOnChainAsset(onChainAsset.metaData, onChainAsset.uriData)
        : null

    return (
        <div className="flex flex-col gap-4 w-full">
            <p className="text-xs text-muted-foreground">
                Choose an existing coin to duplicate, or paste a token mint address to fetch its on-chain metadata
            </p>

            {/* Picker row */}
            <div className="flex items-center gap-2">
                <div className="flex-1">
                    <Combobox<TokenOption>
                        value={selectedOption}
                        onValueChange={opt => {
                            setSelectedOption(opt)
                            setOnChainAsset(null)
                            setError(null)
                        }}
                        inputValue={inputValue}
                        onInputValueChange={val => {
                            setInputValue(val)
                            setError(null)
                            if (selectedOption) setSelectedOption(null)
                        }}
                        filter={null}
                        isItemEqualToValue={(a, b) => a.value === b.value}
                    >
                        <ComboboxInput showClear placeholder="Select a coin or paste a mint address…" className="w-full font-mono" />
                        <ComboboxContent>
                            <ComboboxList>
                                {filteredOptions.map(opt => (
                                    <ComboboxItem key={opt.value} value={opt}>
                                        <div className="flex w-full min-w-0 items-center gap-3">
                                            {opt.token.logo_url ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={opt.token.logo_url} alt="" className="size-6 shrink-0 rounded-full object-cover" />
                                            ) : (
                                                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
                                                    {opt.token.token_symbol.slice(0, 2).toUpperCase()}
                                                </span>
                                            )}
                                            <span className="flex min-w-0 flex-col gap-0.5">
                                                <span className="truncate text-xs font-medium text-foreground">{opt.token.token_name}</span>
                                                <span className="truncate font-mono text-[10px] text-muted-foreground">{opt.token.mint_public_key ?? '—'}</span>
                                            </span>
                                            <span className="ml-auto shrink-0 text-[10px] font-medium text-muted-foreground">{opt.token.token_symbol}</span>
                                            <span className="ml-1 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                                {opt.token.launch_status}
                                            </span>
                                        </div>
                                    </ComboboxItem>
                                ))}
                                {filteredOptions.length === 0 && (
                                    <p className="py-2 text-center text-sm text-muted-foreground">
                                        {inputValue ? 'No matching coins — use “Get Metadata” to look up this address' : 'No coins yet'}
                                    </p>
                                )}
                            </ComboboxList>
                        </ComboboxContent>
                    </Combobox>
                </div>

                {!selectedToken && (
                    <button
                        type="button"
                        onClick={handleGetMetadata}
                        disabled={!inputValue.trim() || loading}
                        className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 h-9 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading && <Loader2 className="size-3.5 animate-spin" />}
                        Get Metadata
                    </button>
                )}
            </div>

            {/* Error */}
            {error && (
                <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
            )}

            {/* DB coin selected — duplicate workflow */}
            {selectedToken && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <SourceCoinPanel coin={clonableCoinFromTokenMint(selectedToken)} formRef={formRef} />
                    <CreateTokenForm ref={formRef} onSubmit={onSubmit} isSubmitting={isSubmitting} />
                </div>
            )}

            {/* Mint address looked up — on-chain metadata, duplicate workflow */}
            {!selectedToken && onChainCoin && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <SourceCoinPanel coin={onChainCoin} formRef={formRef} />
                    <CreateTokenForm ref={formRef} onSubmit={onSubmit} isSubmitting={isSubmitting} />
                </div>
            )}
        </div>
    )
}
