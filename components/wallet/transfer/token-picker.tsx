'use client'

import { useEffect, useMemo, useState } from 'react'
import { PublicKey } from '@solana/web3.js'
import {
    Combobox,
    ComboboxInput,
    ComboboxContent,
    ComboboxList,
    ComboboxItem,
} from '@/components/ui/combobox'
import { FieldLabel } from '@/components/ui/field'
import type { TokenMint } from '@/lib/types/token-mint'

type TokenOption = { value: string; label: string; token: TokenMint }

export interface TokenPickerValue {
    mintAddress: string
    mintValid:   boolean
    tokenSymbol: string | null
    logoUrl:     string | null
}

/**
 * Mint picker shared by the token transfer forms — same combobox pattern as
 * the Comment Bot page's token selector: choose a token launched through this
 * platform, or paste any mint address directly (decimals for a pasted mint
 * aren't known client-side; the transfer routes resolve them on-chain).
 */
export default function TokenPicker({ onChange }: { onChange: (value: TokenPickerValue) => void }) {
    const [tokens, setTokens]                 = useState<TokenMint[]>([])
    const [selectedOption, setSelectedOption] = useState<TokenOption | null>(null)
    const [inputValue, setInputValue]         = useState('')

    useEffect(() => {
        fetch('/api/token-mint/explorer?status=launched&limit=1000')
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => setTokens((data?.tokens ?? []) as TokenMint[]))
            .catch(() => {})
    }, [])

    const tokenOptions: TokenOption[] = useMemo(
        () => tokens.map((t) => ({ value: t.id, label: `${t.token_symbol} — ${t.token_name}`, token: t })),
        [tokens],
    )

    const filteredTokenOptions = useMemo(() => {
        const q = inputValue.trim().toLowerCase()
        if (!q || selectedOption) return tokenOptions
        return tokenOptions.filter((o) =>
            o.label.toLowerCase().includes(q) ||
            o.token.mint_public_key?.toLowerCase().includes(q),
        )
    }, [tokenOptions, inputValue, selectedOption])

    const mintAddress = selectedOption?.token.mint_public_key ?? inputValue.trim()

    const mintValid = useMemo(() => {
        if (!mintAddress) return false
        try {
            new PublicKey(mintAddress)
            return true
        } catch {
            return false
        }
    }, [mintAddress])

    useEffect(() => {
        onChange({
            mintAddress: mintValid ? mintAddress : '',
            mintValid,
            tokenSymbol: selectedOption?.token.token_symbol ?? null,
            logoUrl:     selectedOption?.token.logo_url ?? null,
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mintAddress, mintValid, selectedOption])

    return (
        <div className="flex flex-col gap-1.5">
            <FieldLabel>Token</FieldLabel>
            <Combobox<TokenOption>
                value={selectedOption}
                onValueChange={setSelectedOption}
                inputValue={inputValue}
                onInputValueChange={(val) => {
                    setInputValue(val)
                    if (selectedOption) setSelectedOption(null)
                }}
                filter={null}
                isItemEqualToValue={(a, b) => a.value === b.value}
            >
                <ComboboxInput showClear placeholder="Select a launched token or paste a mint address…" className="w-full font-mono" />
                <ComboboxContent>
                    <ComboboxList>
                        {filteredTokenOptions.map((opt) => (
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
                                </div>
                            </ComboboxItem>
                        ))}
                        {filteredTokenOptions.length === 0 && (
                            <p className="py-2 text-center text-sm text-muted-foreground">
                                {inputValue ? 'No matching token — paste a full mint address to use it directly' : 'No launched tokens yet'}
                            </p>
                        )}
                    </ComboboxList>
                </ComboboxContent>
            </Combobox>
            {inputValue.trim() && !selectedOption && !mintValid && (
                <p className="text-xs text-destructive">Not a valid Solana address</p>
            )}
        </div>
    )
}
