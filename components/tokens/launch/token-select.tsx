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
import { createClient } from '@/lib/supabase/client'
import { CreatedTokenDTO } from '@/app/db/models/token'

// Extends CreatedTokenDTO with display-only fields fetched for this view
interface TokenSelectDTO extends CreatedTokenDTO {
    logo_image_path: string | null
    launched: boolean | null
    website_url: string | null
    twitter_url: string | null
    telegram_handle: string | null
}

type Props = {
    selectedId: number | null
    onSelect: (token: CreatedTokenDTO) => void
}

const supabase = createClient()

export default function TokenSelect({ selectedId, onSelect }: Props) {
    const [tokens, setTokens] = useState<TokenSelectDTO[]>([])
    const [loading, setLoading] = useState(true)
    const [openItem, setOpenItem] = useState<string>('')
    const [copiedId, setCopiedId] = useState<number | null>(null)
    const [search, setSearch] = useState('')

    useEffect(() => {
        supabase
            .from('tokens')
            .select('id, created_at, name, symbol, description, owner_id, dev_wallet_id, contract_address, mint_keypair, logo_image_path, launched, website_url, twitter_url, telegram_handle')
            .order('launched', { ascending: true })
            .order('created_at', { ascending: false })
            .then(({ data, error }) => {
                if (error) console.error('TokenSelect fetch error:', error.message)
                if (data) {
                    setTokens(data.map((t) => ({
                        id: t.id,
                        created_at: t.created_at,
                        token_meta: {
                            name: t.name,
                            symbol: t.symbol,
                            description: t.description,
                            logo_url: t.logo_image_path
                                ? supabase.storage.from('token-media').getPublicUrl(t.logo_image_path).data.publicUrl
                                : undefined,
                        },
                        contract_address: t.contract_address,
                        owner_id: t.owner_id,
                        dev_wallet_id: t.dev_wallet_id,
                        mint_secret_key: t.mint_keypair,
                        logo_image_path: t.logo_image_path,
                        launched: t.launched,
                        website_url: t.website_url,
                        twitter_url: t.twitter_url,
                        telegram_handle: t.telegram_handle,
                    })))
                }
                setLoading(false)
            })
    }, [])

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q) return tokens
        return tokens.filter(
            (t) =>
                t.token_meta.name.toLowerCase().includes(q) ||
                t.token_meta.symbol.toLowerCase().includes(q),
        )
    }, [tokens, search])

    function copyAddress(e: React.MouseEvent, address: string, id: number) {
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
                <span className="flex-1">Contract Address</span>
                <span className="w-24 shrink-0">Launched</span>
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
                            const isLaunched = token.launched === true
                            const isSelected = selectedId === token.id

                            return (
                                <AccordionItem
                                    key={token.id}
                                    value={String(token.id)}
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
                                            {token.token_meta.logo_url ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img
                                                    src={token.token_meta.logo_url}
                                                    alt={token.token_meta.symbol}
                                                    width={28}
                                                    height={28}
                                                    className="rounded-full object-cover size-7 border border-border"
                                                />
                                            ) : (
                                                <span className="size-7 rounded-full bg-muted border border-border flex items-center justify-center text-[10px] font-bold text-muted-foreground">
                                                    {token.token_meta.symbol.slice(0, 1)}
                                                </span>
                                            )}
                                        </span>

                                        <span className="w-20 shrink-0">
                                            <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium font-mono">
                                                {token.token_meta.symbol}
                                            </span>
                                        </span>

                                        <span className="w-36 text-sm font-normal truncate shrink-0">
                                            {token.token_meta.name}
                                        </span>

                                        <span className="flex-1 flex items-center gap-1 min-w-0">
                                            <span className="font-mono text-xs text-muted-foreground truncate">
                                                {token.contract_address ?? '—'}
                                            </span>
                                            {token.contract_address && (
                                                <Tooltip open={copiedId === token.id ? true : undefined}>
                                                    <TooltipTrigger asChild>
                                                        <span
                                                            role="button"
                                                            tabIndex={0}
                                                            onClick={(e) => copyAddress(e, token.contract_address!, token.id!)}
                                                            onKeyDown={(e) => e.key === 'Enter' && copyAddress(e as never, token.contract_address!, token.id!)}
                                                            className="flex items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer shrink-0"
                                                            aria-label="Copy contract address"
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
                                                <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                                                    No
                                                </span>
                                            )}
                                        </span>
                                    </AccordionTrigger>

                                    <AccordionContent className="px-1">
                                        <div className="rounded-lg border bg-muted/40 p-4 grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
                                            {token.token_meta.logo_url && (
                                                <div className="col-span-2 sm:col-span-3 flex items-start gap-4">
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img
                                                        src={token.token_meta.logo_url}
                                                        alt={`${token.token_meta.symbol} logo`}
                                                        className="size-20 rounded-lg object-cover border border-border shrink-0"
                                                    />
                                                    <div className="flex flex-col gap-1">
                                                        <p className="text-xs text-muted-foreground">Logo</p>
                                                        <a href={token.token_meta.logo_url} target="_blank" rel="noreferrer" className="text-xs text-primary underline underline-offset-2 hover:opacity-80">
                                                            View full size ↗
                                                        </a>
                                                    </div>
                                                </div>
                                            )}
                                            <div>
                                                <p className="text-xs text-muted-foreground mb-0.5">Created</p>
                                                <p>{token.created_at?.slice(0, 19).replace('T', ' ')}</p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-muted-foreground mb-0.5">Symbol</p>
                                                <p className="font-mono">{token.token_meta.symbol}</p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-muted-foreground mb-0.5">Name</p>
                                                <p>{token.token_meta.name}</p>
                                            </div>
                                            <div className="col-span-2 sm:col-span-3">
                                                <p className="text-xs text-muted-foreground mb-0.5">Description</p>
                                                <p>{token.token_meta.description}</p>
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
