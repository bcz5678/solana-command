'use client'

import { useState, useMemo } from 'react'

import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Copy } from 'lucide-react'

import { TokenMint } from '@/lib/types/token-mint';



type Props = {
  tokens: TokenMint[]
  walletMap: Record<string, string>
}

function maskKey(key: string) {
  return `${key.slice(0, 5)}.....${key.slice(-5)}`
}

export default function TokenTable({ tokens, walletMap }: Props) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openItem, setOpenItem] = useState<string>('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  function copyAddress(e: React.MouseEvent, address: string, id: string) {
    e.stopPropagation()
    navigator.clipboard.writeText(address)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return tokens
    return tokens.filter(
      (t) =>
        t.token_name.toLowerCase().includes(q) ||
        t.token_symbol.toLowerCase().includes(q),
    )
  }, [tokens, search])

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((t) => selected.has(t.id))

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allFilteredSelected) {
        filtered.forEach((t) => next.delete(t.id))
      } else {
        filtered.forEach((t) => next.add(t.id))
      }
      return next
    })
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or symbol…"
          className="h-9 w-64 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      <p className="text-sm text-muted-foreground min-h-5">
        {selected.size > 0
          ? `${selected.size} token${selected.size !== 1 ? 's' : ''} selected`
          : ''}
      </p>

      <div className="flex items-center border-b pb-2 text-sm font-medium text-muted-foreground">
        <div className="flex flex-1 items-center px-1">
          <div className="flex flex-1 items-center gap-4 min-w-0">
            <span className="w-7 shrink-0" />
            <span className="w-20 shrink-0">Symbol</span>
            <span className="w-36 shrink-0">Name</span>
            <span className="flex-1">Contract Address</span>
            <span className="w-24 shrink-0">Launched</span>
          </div>
          <span className="w-4 shrink-0 ml-auto" />
        </div>
        <Checkbox
          checked={allFilteredSelected}
          onCheckedChange={toggleAll}
          aria-label="Select all"
          className="mr-6 ml-2"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          No tokens match your search.
        </p>
      ) : (
        <Accordion
          type="single"
          collapsible
          value={openItem}
          onValueChange={(val) => setOpenItem(val)}
          className="gap-0"
        >
          {filtered.map((token) => (
            <AccordionItem key={token.id} value={String(token.id)}>
              <AccordionTrigger
                className="hover:no-underline px-1"
                headerSlot={
                  <span
                    onClick={(e) => e.stopPropagation()}
                    className="mr-2 shrink-0 self-center"
                  >
                    <Checkbox
                      checked={selected.has(token.id)}
                      onCheckedChange={() => toggleOne(token.id)}
                      aria-label={`Select token ${token.id}`}
                    />
                  </span>
                }
              >
                <div className="flex flex-1 items-center gap-4 min-w-0">
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
                      <TooltipProvider>
                        <Tooltip open={copiedId === token.id ? true : undefined}>
                          <TooltipTrigger asChild>
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => copyAddress(e, token.mint_public_key!, token.id)}
                              onKeyDown={(e) => e.key === 'Enter' && copyAddress(e as never, token.mint_public_key!, token.id)}
                              className="flex items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer shrink-0"
                              aria-label="Copy contract address"
                            >
                              <Copy className="size-3" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            {copiedId === token.id ? 'Copied to clipboard' : 'Copy address'}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </span>
                  <span className="w-24 shrink-0">
                    {token.launch_status && token.launch_status !== 'false' ? (
                      <span className="inline-flex items-center rounded-md bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                        {token.launch_status}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        No
                      </span>
                    )}
                  </span>
                </div>
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
                        <a
                          href={token.logo_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary underline underline-offset-2 hover:opacity-80"
                        >
                          View full size ↗
                        </a>
                      </div>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Created At</p>
                    <p>{token.created_at.slice(0, 19).replace('T', ' ')}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Dev Wallet</p>
                    <p className="font-mono text-xs">
                      {walletMap[token.dev_wallet_id]
                        ? maskKey(walletMap[token.dev_wallet_id])
                        : token.dev_wallet_id}
                    </p>
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
                    <p>{token.description}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Website</p>
                    <p className="truncate text-xs">{token.website_url ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Twitter</p>
                    <p className="truncate text-xs">{token.twitter_url ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Telegram</p>
                    <p>{token.telegram_handle ?? '—'}</p>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  )
}
