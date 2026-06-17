'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { TokenMint } from '@/lib/types/token-mint'

type Props = {
    onSelect: (token: TokenMint | null, mintAddress: string) => void
}

const STATUS_BADGE: Record<string, string> = {
    launched:  'bg-green-500/15 text-green-700 dark:text-green-400',
    ready:     'bg-blue-500/15 text-blue-700 dark:text-blue-400',
    launching: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
    failed:    'bg-red-500/15 text-red-600 dark:text-red-400',
    draft:     'bg-muted text-muted-foreground',
}

function TokenLogo({ token }: { token: TokenMint }) {
    if (token.logo_url) {
        return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
                src={token.logo_url}
                alt={token.token_symbol}
                width={20}
                height={20}
                className="size-5 rounded-full object-cover border border-border shrink-0"
            />
        )
    }
    return (
        <span className="size-5 rounded-full bg-muted border border-border flex items-center justify-center text-[9px] font-bold text-muted-foreground shrink-0">
            {token.token_symbol.slice(0, 1)}
        </span>
    )
}

export default function StrategyTokenSelector({ onSelect }: Props) {
    const [tokens, setTokens]               = useState<TokenMint[]>([])
    const [loading, setLoading]             = useState(true)
    const [open, setOpen]                   = useState(false)
    const [inputValue, setInputValue]       = useState('')
    const [resolvedToken, setResolvedToken] = useState<TokenMint | null>(null)
    const containerRef                      = useRef<HTMLDivElement>(null)
    const inputRef                          = useRef<HTMLInputElement>(null)

    useEffect(() => {
        fetch('/api/token-mint/explorer?status=all')
            .then((r) => r.ok ? r.json() : null)
            .then((data) => {
                if (data) setTokens(data.tokens ?? [])
                setLoading(false)
            })
            .catch(() => setLoading(false))
    }, [])

    useEffect(() => {
        function onOutsideClick(e: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }
        document.addEventListener('mousedown', onOutsideClick)
        return () => document.removeEventListener('mousedown', onOutsideClick)
    }, [])

    const mintIndex = useMemo(
        () => Object.fromEntries(tokens.map((t) => [t.mint_public_key ?? '', t])),
        [tokens],
    )

    const sorted = useMemo(() => {
        return [...tokens].sort((a, b) => {
            const aL = a.launch_status === 'launched' ? 0 : 1
            const bL = b.launch_status === 'launched' ? 0 : 1
            if (aL !== bL) return aL - bL
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        })
    }, [tokens])

    const filtered = useMemo(() => {
        const q = inputValue.trim().toLowerCase()
        if (!q) return sorted
        return sorted.filter((t) =>
            t.token_name.toLowerCase().includes(q) ||
            t.token_symbol.toLowerCase().includes(q) ||
            (t.mint_public_key ?? '').toLowerCase().includes(q),
        )
    }, [sorted, inputValue])

    const launchedGroup = filtered.filter((t) => t.launch_status === 'launched')
    const otherGroup    = filtered.filter((t) => t.launch_status !== 'launched')

    function handleInputChange(value: string) {
        setInputValue(value)
        setOpen(true)
        const exact = mintIndex[value] ?? null
        setResolvedToken(exact)
        onSelect(exact, value)
    }

    function handleSelect(token: TokenMint) {
        if (token.launch_status === 'draft') return
        const mint = token.mint_public_key ?? ''
        setInputValue(mint)
        setResolvedToken(token)
        setOpen(false)
        onSelect(token, mint)
    }

    function handleClear() {
        setInputValue('')
        setResolvedToken(null)
        setOpen(false)
        onSelect(null, '')
        inputRef.current?.focus()
    }

    return (
        <div ref={containerRef} className="relative flex flex-col gap-1.5 w-full">
            <p className="text-xs text-muted-foreground">
                Paste a token pair CA or select a launched token
            </p>

            {/* Input */}
            <div className="flex items-center gap-1.5 rounded-lg border border-input bg-transparent px-3 h-9 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
                <input
                    ref={inputRef}
                    value={inputValue}
                    onChange={(e) => handleInputChange(e.target.value)}
                    onFocus={() => setOpen(true)}
                    placeholder={loading ? 'Loading tokens…' : 'Paste mint address or search by name / symbol…'}
                    className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground min-w-0"
                />
                {inputValue && (
                    <button
                        type="button"
                        onClick={handleClear}
                        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                        aria-label="Clear"
                    >
                        <X className="size-3.5" />
                    </button>
                )}
                <button
                    type="button"
                    onClick={() => { setOpen((v) => !v); inputRef.current?.focus() }}
                    className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Toggle dropdown"
                >
                    <ChevronDown className={`size-4 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
                </button>
            </div>

            {/* Dropdown */}
            {open && (
                <div className="absolute left-0 top-[calc(100%+4px)] z-50 w-full rounded-lg border bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10">
                    <ul className="max-h-72 overflow-y-auto p-1">
                        {/* Launched group */}
                        {launchedGroup.length > 0 && (
                            <>
                                <li className="px-2 py-1.5 text-xs font-medium text-muted-foreground select-none">
                                    Launched
                                </li>
                                {launchedGroup.map((token) => (
                                    <TokenListItem
                                        key={token.id}
                                        token={token}
                                        selected={resolvedToken?.id === token.id}
                                        disabled={false}
                                        onSelect={handleSelect}
                                    />
                                ))}
                            </>
                        )}

                        {launchedGroup.length > 0 && otherGroup.length > 0 && (
                            <li className="my-1 mx-1 h-px bg-border" role="separator" />
                        )}

                        {/* Other group */}
                        {otherGroup.length > 0 && (
                            <>
                                <li className="px-2 py-1.5 text-xs font-medium text-muted-foreground select-none">
                                    Other
                                </li>
                                {otherGroup.map((token) => (
                                    <TokenListItem
                                        key={token.id}
                                        token={token}
                                        selected={resolvedToken?.id === token.id}
                                        disabled={token.launch_status === 'draft'}
                                        onSelect={handleSelect}
                                    />
                                ))}
                            </>
                        )}

                        {filtered.length === 0 && (
                            <li className="py-4 text-center text-sm text-muted-foreground">
                                No tokens found.
                            </li>
                        )}
                    </ul>
                </div>
            )}

            {/* Resolved token preview */}
            {resolvedToken && (
                <div className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/5 px-3 py-1.5 text-xs">
                    <TokenLogo token={resolvedToken} />
                    <span className="font-mono font-semibold">{resolvedToken.token_symbol}</span>
                    <span className="text-muted-foreground">{resolvedToken.token_name}</span>
                    <span className={`ml-auto inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${STATUS_BADGE[resolvedToken.launch_status] ?? ''}`}>
                        {resolvedToken.launch_status}
                    </span>
                </div>
            )}
        </div>
    )
}

function TokenListItem({
    token,
    selected,
    disabled,
    onSelect,
}: {
    token: TokenMint
    selected: boolean
    disabled: boolean
    onSelect: (t: TokenMint) => void
}) {
    return (
        <li>
            <button
                type="button"
                disabled={disabled}
                onClick={() => onSelect(token)}
                className={[
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors text-left',
                    disabled
                        ? 'opacity-40 cursor-not-allowed'
                        : selected
                        ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                        : 'hover:bg-accent hover:text-accent-foreground',
                ].join(' ')}
            >
                <TokenLogo token={token} />
                <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold shrink-0">
                    {token.token_symbol}
                </span>
                <span className="truncate text-muted-foreground">{token.token_name}</span>
                <span className={`ml-auto shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${STATUS_BADGE[token.launch_status] ?? ''}`}>
                    {token.launch_status}
                </span>
            </button>
        </li>
    )
}
