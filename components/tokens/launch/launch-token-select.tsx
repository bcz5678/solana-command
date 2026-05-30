'use client'

import { useState, useEffect, useMemo } from 'react'
import {
    Accordion,
    AccordionItem,
    AccordionTrigger,
    AccordionContent,
} from '@/components/ui/accordion'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip'
import { Copy } from 'lucide-react'
import { TokenMint } from '@/lib/types/token'

type Props = {
    selectedId: string | null
    onSelect: (token: TokenMint) => void
}

export default function LaunchTokenSelect({ selectedId, onSelect }: Props) {
    const [tokens, setTokens] = useState<TokenMint[]>([])
    const [loading, setLoading] = useState(true)
    const [openItem, setOpenItem] = useState<string>('')
    const [copiedId, setCopiedId] = useState<string | null>(null)
    const [search, setSearch] = useState('')

    useEffect(() => {
        fetch('/api/token/explorer?status=all')
            .then((r) => {
                if (!r.ok) {
                    r.json().then(body => console.error('[tokens] API error', r.status, body))
                    return
                }
                return r.json()
            })
            .then((data) => {
                if (!data) return
                setTokens(data.tokens ?? [])
                setLoading(false)
            })
            .catch((err) => {
                console.error('LaunchTokenSelect fetch error:', err)
                setLoading(false)
            })
    }, [])

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q) return tokens
        return tokens.filter(
            (t) =>
                t.token_name.toLowerCase().includes(q) ||
                t.token_symbol.toLowerCase().includes(q),
        )
    }, [tokens, search])

    function copyAddress(e: React.MouseEvent, address: string, id: string) {
        e.stopPropagation()
        navigator.clipboard.writeText(address)
        setCopiedId(id)
        setTimeout(() => setCopiedId(null), 2000)
    }

    if (loading) {
        return <p className="text-sm text-muted-foreground py-4">Loading tokens…</p>
    }

    return (
        <div className="flex flex-col gap-4">
            <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or symbol…"
                className="h-9 w-64 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />

            <p className="text-sm text-muted-foreground min-h-5">
                {selectedId !== null ? '1 token selected' : 'Select a token to continue'}
            </p>

            {/* Header row */}
            <div className="flex items-center border-b pb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground px-1 gap-4">
                <span className="w-5 shrink-0" />
                <span className="w-7 shrink-0" />
                <span className="w-20 shrink-0">Symbol</span>
                <span className="w-36 shrink-0">Name</span>
                <span className="flex-1">Mint Address</span>
                <span className="w-24 shrink-0">Status</span>
                <span className="w-4 shrink-0" />
            </div>

            {filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No tokens found.</p>
            ) : (
                <TooltipProvider>
                    <Accordion
                        type="single"
                        collapsible
                        value={openItem}
                        onValueChange={setOpenItem}
                    >
                        {filtered.map((token) => {
                            const isLaunched = token.launch_status === 'launched'
                            const isSelected = selectedId === token.id

                            return (
                                <AccordionItem
                                    key={token.id}
                                    value={token.id}
                                    className={[
                                        'transition-colors',
                                        isSelected ? 'bg-blue-500/5 border-l-2 border-l-blue-500' : '',
                                        isLaunched ? 'opacity-50' : '',
                                    ].join(' ')}
                                >
                                    <AccordionTrigger className="hover:no-underline px-1 gap-4">
                                        {/* Radio selector */}
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <span
                                                    className={[
                                                        'w-5 shrink-0 flex items-center justify-center',
                                                        isLaunched ? 'cursor-not-allowed' : 'cursor-pointer',
                                                    ].join(' ')}
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        if (!isLaunched) onSelect(token)
                                                    }}
                                                >
                                                    <span className={[
                                                        'size-4 rounded-full border-2 flex items-center justify-center transition-colors shrink-0',
                                                        isSelected
                                                            ? 'border-blue-500 bg-blue-500'
                                                            : isLaunched
                                                            ? 'border-muted-foreground/20 bg-muted'
                                                            : 'border-muted-foreground/40 hover:border-blue-400',
                                                    ].join(' ')}>
                                                        {isSelected && (
                                                            <span className="size-1.5 rounded-full bg-white" />
                                                        )}
                                                    </span>
                                                </span>
                                            </TooltipTrigger>
                                            {isLaunched && (
                                                <TooltipContent side="top">
                                                    This token has already been launched
                                                </TooltipContent>
                                            )}
                                        </Tooltip>

                                        {/* Logo */}
                                        <span className="w-7 shrink-0 flex items-center justify-center">
                                            {token.logo_url ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img
                                                    src={token.logo_url}
                                                    alt={token.token_symbol}
                                                    width={28}
                                                    height={28}
                                                    className="rounded-full object-cover size-7 border border-border"
                                                />
                                            ) : (
                                                <span className="size-7 rounded-full bg-muted border border-border flex items-center justify-center text-[10px] font-bold text-muted-foreground">
                                                    {token.token_symbol.slice(0, 1)}
                                                </span>
                                            )}
                                        </span>

                                        <span className="w-20 shrink-0">
                                            <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium font-mono">
                                                {token.token_symbol}
                                            </span>
                                        </span>

                                        <span className="w-36 text-sm font-normal truncate shrink-0">
                                            {token.token_name}
                                        </span>

                                        <span className="flex-1 flex items-center gap-1 min-w-0">
                                            <span className="font-mono text-xs text-muted-foreground truncate">
                                                {token.mint_public_key ?? '—'}
                                            </span>
                                            {token.mint_public_key && (
                                                <Tooltip open={copiedId === token.id ? true : undefined}>
                                                    <TooltipTrigger asChild>
                                                        <span
                                                            role="button"
                                                            tabIndex={0}
                                                            onClick={(e) => copyAddress(e, token.mint_public_key!, token.id)}
                                                            onKeyDown={(e) => e.key === 'Enter' && copyAddress(e as never, token.mint_public_key!, token.id)}
                                                            className="flex items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer shrink-0"
                                                            aria-label="Copy mint address"
                                                        >
                                                            <Copy className="size-3" />
                                                        </span>
                                                    </TooltipTrigger>
                                                    <TooltipContent side="top">
                                                        {copiedId === token.id ? 'Copied!' : 'Copy address'}
                                                    </TooltipContent>
                                                </Tooltip>
                                            )}
                                        </span>

                                        <span className="w-24 shrink-0">
                                            {isLaunched ? (
                                                <span className="inline-flex items-center rounded-md bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                                                    Launched
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground capitalize">
                                                    {token.launch_status}
                                                </span>
                                            )}
                                        </span>
                                    </AccordionTrigger>

                                    <AccordionContent className="px-1">
                                        <div className="rounded-lg border bg-muted/40 p-4 grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
                                            {token.logo_url && (
                                                <div className="col-span-2 sm:col-span-3 flex items-start gap-4">
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img
                                                        src={token.logo_url}
                                                        alt={`${token.token_symbol} logo`}
                                                        className="size-20 rounded-lg object-cover border border-border shrink-0"
                                                    />
                                                    <div className="flex flex-col gap-1">
                                                        <p className="text-xs text-muted-foreground">Logo</p>
                                                        <a href={token.logo_url} target="_blank" rel="noreferrer" className="text-xs text-primary underline underline-offset-2 hover:opacity-80">
                                                            View full size ↗
                                                        </a>
                                                    </div>
                                                </div>
                                            )}
                                            <div>
                                                <p className="text-xs text-muted-foreground mb-0.5">Created</p>
                                                <p>{token.created_at.slice(0, 19).replace('T', ' ')}</p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-muted-foreground mb-0.5">Symbol</p>
                                                <p className="font-mono">{token.token_symbol}</p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-muted-foreground mb-0.5">Name</p>
                                                <p>{token.token_name}</p>
                                            </div>
                                            <div className="col-span-2 sm:col-span-3">
                                                <p className="text-xs text-muted-foreground mb-0.5">Description</p>
                                                <p>{token.description ?? '—'}</p>
                                            </div>
                                            {token.website_url && (
                                                <div>
                                                    <p className="text-xs text-muted-foreground mb-0.5">Website</p>
                                                    <p className="truncate text-xs">{token.website_url}</p>
                                                </div>
                                            )}
                                            {token.twitter_url && (
                                                <div>
                                                    <p className="text-xs text-muted-foreground mb-0.5">Twitter</p>
                                                    <p className="truncate text-xs">{token.twitter_url}</p>
                                                </div>
                                            )}
                                            {token.telegram_handle && (
                                                <div>
                                                    <p className="text-xs text-muted-foreground mb-0.5">Telegram</p>
                                                    <p>{token.telegram_handle}</p>
                                                </div>
                                            )}
                                        </div>
                                    </AccordionContent>
                                </AccordionItem>
                            )
                        })}
                    </Accordion>
                </TooltipProvider>
            )}
        </div>
    )
}
