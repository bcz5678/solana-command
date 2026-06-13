'use client'

import { useState, useEffect, useRef } from 'react'
import { TokenMint } from '@/lib/types/token-mint'

type ResolvedToken = { name: string; symbol: string; mintAddress: string }

type Props = {
    onTokenChange: (mint: string, resolved: boolean) => void
}

export function TokenMintInput({ onTokenChange }: Props) {
    const [ownTokens, setOwnTokens] = useState<TokenMint[]>([])
    const [query, setQuery]         = useState('')
    const [open, setOpen]           = useState(false)
    const [resolved, setResolved]   = useState<ResolvedToken | null>(null)
    const [loading, setLoading]     = useState(false)
    const [error, setError]         = useState('')
    const debounceRef               = useRef<ReturnType<typeof setTimeout> | null>(null)
    const containerRef              = useRef<HTMLDivElement>(null)
    const callbackRef               = useRef(onTokenChange)
    useEffect(() => { callbackRef.current = onTokenChange })

    useEffect(() => {
        fetch('/api/token-mint/explorer?status=launched')
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d) setOwnTokens(d.tokens ?? []) })
            .catch(() => {})
    }, [])

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current)
        setResolved(null)
        setError('')

        if (query.length < 32) {
            callbackRef.current('', false)
            return
        }

        // Instant match against own tokens by mint address
        const ownMatch = ownTokens.find(t => t.mint_public_key === query)
        if (ownMatch) {
            const r: ResolvedToken = { name: ownMatch.token_name, symbol: ownMatch.token_symbol, mintAddress: query }
            setResolved(r)
            callbackRef.current(query, true)
            return
        }

        // Debounced API fetch for arbitrary CA
        setLoading(true)
        debounceRef.current = setTimeout(async () => {
            try {
                const res = await fetch(`/api/pumpfun/token-info?mintAddress=${encodeURIComponent(query)}`)
                if (!res.ok) throw new Error()
                const { body: { snapshot } } = await res.json()
                const r: ResolvedToken = { name: snapshot.name, symbol: snapshot.symbol, mintAddress: query }
                setResolved(r)
                callbackRef.current(query, true)
            } catch {
                setError('Token not found')
                callbackRef.current('', false)
            } finally {
                setLoading(false)
            }
        }, 800)

        return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
    }, [query, ownTokens])

    // Close on outside click (use mousedown so it fires before blur)
    useEffect(() => {
        function handle(e: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }
        document.addEventListener('mousedown', handle)
        return () => document.removeEventListener('mousedown', handle)
    }, [])

    const filtered = query.length < 32
        ? ownTokens.filter(t =>
            t.token_name.toLowerCase().includes(query.toLowerCase()) ||
            t.token_symbol.toLowerCase().includes(query.toLowerCase()),
          )
        : []

    function selectToken(token: TokenMint) {
        const r: ResolvedToken = { name: token.token_name, symbol: token.token_symbol, mintAddress: token.mint_public_key }
        setQuery(token.mint_public_key)
        setResolved(r)
        setError('')
        setOpen(false)
        callbackRef.current(token.mint_public_key, true)
    }

    function clear() {
        setQuery('')
        setResolved(null)
        setError('')
        callbackRef.current('', false)
    }

    return (
        <div ref={containerRef} className="relative flex flex-col gap-1.5">
            <div className="relative flex items-center">
                <input
                    type="text"
                    value={query}
                    onChange={e => { setQuery(e.target.value); setOpen(true) }}
                    onFocus={() => setOpen(true)}
                    placeholder="Search your tokens or paste a mint address…"
                    spellCheck={false}
                    autoComplete="off"
                    className="h-9 w-full rounded-lg border border-input bg-transparent pl-3 pr-8 font-mono text-xs placeholder:font-sans focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                {loading ? (
                    <span className="absolute right-3 size-3.5 rounded-full border-2 border-border border-t-primary animate-spin" />
                ) : query ? (
                    <button
                        type="button"
                        onClick={clear}
                        className="absolute right-3 text-xs text-muted-foreground hover:text-destructive transition-colors"
                    >
                        ✕
                    </button>
                ) : null}
            </div>

            {resolved && (
                <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{resolved.name}</span>
                    {' '}
                    <span className="opacity-60">{resolved.symbol}</span>
                </p>
            )}

            {error && (
                <p className="flex items-center gap-1.5 text-xs text-destructive">
                    <span>⚠</span> {error}
                </p>
            )}

            {open && filtered.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-popover shadow-md">
                    {filtered.map(token => (
                        <button
                            key={token.id}
                            type="button"
                            onMouseDown={e => { e.preventDefault(); selectToken(token) }}
                            className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
                        >
                            {token.logo_url ? (
                                <img src={token.logo_url} alt="" className="size-6 shrink-0 rounded-full object-cover" />
                            ) : (
                                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
                                    {token.token_symbol.slice(0, 2).toUpperCase()}
                                </span>
                            )}
                            <span className="flex min-w-0 flex-col gap-0.5">
                                <span className="text-xs font-medium text-foreground">{token.token_name}</span>
                                <span className="truncate font-mono text-[10px] text-muted-foreground">{token.mint_public_key}</span>
                            </span>
                            <span className="ml-auto shrink-0 text-[10px] font-medium text-muted-foreground">{token.token_symbol}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
