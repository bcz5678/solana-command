'use client'

import { useState, useMemo, useRef, useEffect } from 'react'

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
import { Button } from '@/components/ui/button'

import { TokenMint } from '@/lib/types/token-mint'

type Props = {
  tokens: TokenMint[]
  walletMap: Record<string, string>
}

type DraftEdit = {
  name:            string
  symbol:          string
  description:     string
  website_url:     string
  twitter_url:     string
  telegram_handle: string
  tiktok_url:      string
  instagram_url:   string
  discord_url:     string
  communities_url: string
  logoFile:        File | null
  logoPreview:     string | null
  bannerFile:      File | null
  bannerPreview:   string | null
}

function maskKey(key: string) {
  return `${key.slice(0, 5)}.....${key.slice(-5)}`
}

const inputCls =
  'w-full rounded border border-input bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

function UploadIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  )
}

export default function TokenTable({ tokens, walletMap }: Props) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openItem, setOpenItem] = useState<string>('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [editMap, setEditMap] = useState<Record<string, DraftEdit>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<Record<string, 'success' | string>>({})

  // Ref maps so each token row can trigger its own hidden file inputs
  const logoInputRefs   = useRef<Record<string, HTMLInputElement | null>>({})
  const bannerInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  // Keep a stable ref to editMap for cleanup on unmount
  const editMapRef = useRef(editMap)
  editMapRef.current = editMap

  useEffect(() => {
    return () => {
      Object.values(editMapRef.current).forEach(e => {
        if (e.logoPreview)   URL.revokeObjectURL(e.logoPreview)
        if (e.bannerPreview) URL.revokeObjectURL(e.bannerPreview)
      })
    }
  }, [])

  function copyAddress(e: React.MouseEvent, address: string, id: string) {
    e.stopPropagation()
    navigator.clipboard.writeText(address)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  function handleAccordionChange(val: string) {
    setOpenItem(val)
    if (!val) return
    const token = tokens.find(t => String(t.id) === val)
    if (token && token.launch_status === 'draft' && !editMap[token.id]) {
      setEditMap(prev => ({
        ...prev,
        [token.id]: {
          name:            token.token_name       ?? '',
          symbol:          token.token_symbol     ?? '',
          description:     token.description     ?? '',
          website_url:     token.website_url      ?? '',
          twitter_url:     token.twitter_url      ?? '',
          telegram_handle: token.telegram_handle  ?? '',
          tiktok_url:      token.tiktok_url       ?? '',
          instagram_url:   token.instagram_url    ?? '',
          discord_url:     token.discord_url      ?? '',
          communities_url: token.communities_url  ?? '',
          logoFile:        null,
          logoPreview:     null,
          bannerFile:      null,
          bannerPreview:   null,
        },
      }))
    }
  }

  function patchEdit(tokenId: string, patch: Partial<DraftEdit>) {
    setEditMap(prev => {
      const current = prev[tokenId]
      // Revoke blob URLs being replaced
      if (patch.logoPreview   && current?.logoPreview   && current.logoPreview   !== patch.logoPreview)
        URL.revokeObjectURL(current.logoPreview)
      if (patch.bannerPreview && current?.bannerPreview && current.bannerPreview !== patch.bannerPreview)
        URL.revokeObjectURL(current.bannerPreview)
      return { ...prev, [tokenId]: { ...current, ...patch } }
    })
  }

  async function saveDraft(token: TokenMint) {
    const edits = editMap[token.id]
    if (!edits) return
    setSavingId(token.id)
    setSaveStatus(prev => ({ ...prev, [token.id]: '' }))

    try {
      // ── Upload logo if staged ────────────────────────────────
      let newLogoUrl: string | undefined
      if (edits.logoFile) {
        // Overwrite the same S3 key; fall back to standard naming if no existing URL
        const ext         = edits.logoFile.name.split('.').pop()
        const existingKey = token.logo_url
          ? decodeURIComponent(token.logo_url.split('/').pop() ?? '')
          : `${token.token_symbol}_${token.mint_public_key.slice(0, 7)}_logo.${ext}`
        const renamed = new File([edits.logoFile], existingKey, { type: edits.logoFile.type })
        const form    = new FormData()
        form.append('image', renamed)
        const r = await fetch('/api/token-mint/upload-image', { method: 'POST', body: form })
        if (!r.ok) {
          const b = await r.json().catch(() => ({}))
          setSaveStatus(prev => ({ ...prev, [token.id]: b.error ?? 'Logo upload failed' }))
          return
        }
        ;({ url: newLogoUrl } = await r.json())
      }

      // ── Upload banner if staged ──────────────────────────────
      let newBannerUrl: string | undefined
      if (edits.bannerFile) {
        const ext         = edits.bannerFile.name.split('.').pop()
        const existingKey = token.banner_url
          ? decodeURIComponent(token.banner_url.split('/').pop() ?? '')
          : `${token.token_symbol}_${token.mint_public_key.slice(0, 7)}_banner.${ext}`
        const renamed = new File([edits.bannerFile], existingKey, { type: edits.bannerFile.type })
        const form    = new FormData()
        form.append('image', renamed)
        const r = await fetch('/api/token-mint/upload-image', { method: 'POST', body: form })
        if (!r.ok) {
          const b = await r.json().catch(() => ({}))
          setSaveStatus(prev => ({ ...prev, [token.id]: b.error ?? 'Banner upload failed' }))
          return
        }
        ;({ url: newBannerUrl } = await r.json())
      }

      // ── Update DB ────────────────────────────────────────────
      const res = await fetch('/api/token-mint/update-token-draft', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mintId:         token.id,
          tokenName:      edits.name,
          tokenSymbol:    edits.symbol,
          description:    edits.description,
          websiteUrl:     edits.website_url,
          twitterUrl:     edits.twitter_url,
          telegramHandle: edits.telegram_handle,
          tiktokUrl:      edits.tiktok_url,
          instagramUrl:   edits.instagram_url,
          discordUrl:     edits.discord_url,
          communitiesUrl: edits.communities_url,
          ...(newLogoUrl   !== undefined && { logoUrl:   newLogoUrl }),
          ...(newBannerUrl !== undefined && { bannerUrl: newBannerUrl }),
        }),
      })

      if (res.ok) {
        // Sync S3 meta file
        await fetch('/api/token-mint/update-meta', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mintId: token.id }),
        })
        // Clear staged files; keep blob previews so new images stay visible
        patchEdit(token.id, { logoFile: null, bannerFile: null })
        setSaveStatus(prev => ({ ...prev, [token.id]: 'success' }))
        setTimeout(() => setSaveStatus(prev => ({ ...prev, [token.id]: '' })), 3000)
      } else {
        const body = await res.json().catch(() => ({}))
        setSaveStatus(prev => ({ ...prev, [token.id]: body.error ?? 'Save failed' }))
      }
    } catch {
      setSaveStatus(prev => ({ ...prev, [token.id]: 'Network error' }))
    } finally {
      setSavingId(null)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const visible = tokens.filter(
      t => t.launch_status === 'draft' || t.launch_status === 'launched',
    )
    const matched = q
      ? visible.filter(
          t =>
            t.token_name.toLowerCase().includes(q) ||
            t.token_symbol.toLowerCase().includes(q),
        )
      : visible
    return [...matched].sort((a, b) =>
      a.launch_status === b.launch_status ? 0 : a.launch_status === 'draft' ? -1 : 1,
    )
  }, [tokens, search])

  const allFilteredSelected =
    filtered.length > 0 && filtered.every(t => selected.has(t.id))

  function toggleAll() {
    setSelected(prev => {
      const next = new Set(prev)
      if (allFilteredSelected) filtered.forEach(t => next.delete(t.id))
      else                      filtered.forEach(t => next.add(t.id))
      return next
    })
  }

  function toggleOne(id: string) {
    setSelected(prev => {
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
          onChange={e => setSearch(e.target.value)}
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
          onValueChange={handleAccordionChange}
          className="gap-0"
        >
          {filtered.map(token => {
            const isDraft = token.launch_status === 'draft'
            const edits   = editMap[token.id]
            const isSaving = savingId === token.id
            const status   = saveStatus[token.id]

            const logoSrc   = edits?.logoPreview   ?? token.logo_url   ?? null
            const bannerSrc = edits?.bannerPreview ?? token.banner_url ?? null

            return (
              <AccordionItem key={token.id} value={String(token.id)}>
                <AccordionTrigger
                  className="hover:no-underline px-1"
                  headerSlot={
                    <span
                      onClick={e => e.stopPropagation()}
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
                                onClick={e => copyAddress(e, token.mint_public_key!, token.id)}
                                onKeyDown={e => e.key === 'Enter' && copyAddress(e as never, token.mint_public_key!, token.id)}
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
                      {token.launch_status ? (
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

                    {/* ── Logo ──────────────────────────────────── */}
                    {(logoSrc || isDraft) && (
                      <div className="col-span-2 sm:col-span-3 flex items-start gap-4">
                        <div
                          className={isDraft && edits ? 'relative group cursor-pointer shrink-0' : 'shrink-0'}
                          onClick={isDraft && edits ? () => logoInputRefs.current[token.id]?.click() : undefined}
                        >
                          {logoSrc ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={logoSrc}
                              alt={`${token.token_symbol} logo`}
                              className="size-20 rounded-lg object-cover border border-border"
                            />
                          ) : (
                            <div className="size-20 rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 text-[10px] text-muted-foreground">
                              <UploadIcon />
                              <span>Add logo</span>
                            </div>
                          )}
                          {isDraft && edits && logoSrc && (
                            <div className="absolute inset-0 rounded-lg bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                              <span className="text-white text-xs font-medium">Replace</span>
                            </div>
                          )}
                          {isDraft && edits && (
                            <input
                              ref={el => { logoInputRefs.current[token.id] = el }}
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={e => {
                                const file = e.target.files?.[0] ?? null
                                if (file) patchEdit(token.id, { logoFile: file, logoPreview: URL.createObjectURL(file) })
                              }}
                            />
                          )}
                        </div>
                        <div className="flex flex-col gap-1">
                          <p className="text-xs text-muted-foreground">
                            Logo{isDraft && edits ? ' · click to replace' : ''}
                          </p>
                          {logoSrc && (
                            <a
                              href={logoSrc}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-primary underline underline-offset-2 hover:opacity-80"
                            >
                              View full size ↗
                            </a>
                          )}
                          {edits?.logoFile && (
                            <span className="text-xs text-muted-foreground truncate max-w-[12rem]">
                              {edits.logoFile.name}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* ── Banner ────────────────────────────────── */}
                    {(bannerSrc || isDraft) && (
                      <div className="col-span-2 sm:col-span-3 flex flex-col gap-2">
                        {bannerSrc ? (
                          <div
                            className={isDraft && edits ? 'relative group cursor-pointer' : ''}
                            onClick={isDraft && edits ? () => bannerInputRefs.current[token.id]?.click() : undefined}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={bannerSrc}
                              alt={`${token.token_symbol} banner`}
                              className="w-full h-24 rounded-lg object-cover border border-border"
                            />
                            {isDraft && edits && (
                              <div className="absolute inset-0 rounded-lg bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <span className="text-white text-xs font-medium">Replace Banner</span>
                              </div>
                            )}
                          </div>
                        ) : isDraft && edits ? (
                          <div
                            className="w-full h-24 rounded-lg border-2 border-dashed border-border flex items-center justify-center gap-2 text-xs text-muted-foreground cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
                            onClick={() => bannerInputRefs.current[token.id]?.click()}
                          >
                            <UploadIcon />
                            <span>Add banner — drag & drop or <span className="text-primary underline">browse</span></span>
                          </div>
                        ) : null}

                        {isDraft && edits && (
                          <input
                            ref={el => { bannerInputRefs.current[token.id] = el }}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={e => {
                              const file = e.target.files?.[0] ?? null
                              if (file) patchEdit(token.id, { bannerFile: file, bannerPreview: URL.createObjectURL(file) })
                            }}
                          />
                        )}

                        <div className="flex items-center justify-between">
                          <p className="text-xs text-muted-foreground">
                            Banner
                            {isDraft && edits && bannerSrc ? ' · click to replace' : ''}
                            {edits?.bannerFile ? ` · ${edits.bannerFile.name}` : ''}
                          </p>
                          {bannerSrc && (
                            <a
                              href={bannerSrc}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-primary underline underline-offset-2 hover:opacity-80"
                            >
                              View full size ↗
                            </a>
                          )}
                        </div>
                      </div>
                    )}

                    {/* ── Read-only fields ──────────────────────── */}
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Created At</p>
                      <p>{token.created_at.slice(0, 19).replace('T', ' ')}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Dev Wallet</p>
                      <p className="font-mono text-xs">
                        {walletMap[token.dev_wallet_id!]
                          ? maskKey(walletMap[token.dev_wallet_id!])
                          : token.dev_wallet_id}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Symbol</p>
                      {isDraft && edits ? (
                        <input type="text" value={edits.symbol} placeholder="TOKEN"
                          onChange={e => patchEdit(token.id, { symbol: e.target.value })}
                          className={`${inputCls} font-mono`} />
                      ) : (
                        <p className="font-mono">{token.token_symbol}</p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Name</p>
                      {isDraft && edits ? (
                        <input type="text" value={edits.name} placeholder="Token Name"
                          onChange={e => patchEdit(token.id, { name: e.target.value })}
                          className={inputCls} />
                      ) : (
                        <p>{token.token_name}</p>
                      )}
                    </div>

                    {/* ── Editable fields (draft only) ──────────── */}
                    <div className="col-span-2 sm:col-span-3">
                      <p className="text-xs text-muted-foreground mb-0.5">Description</p>
                      {isDraft && edits ? (
                        <textarea
                          rows={3}
                          value={edits.description}
                          onChange={e => patchEdit(token.id, { description: e.target.value })}
                          className={`${inputCls} resize-none`}
                        />
                      ) : (
                        <p>{token.description}</p>
                      )}
                    </div>

                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Website</p>
                      {isDraft && edits ? (
                        <input type="url" value={edits.website_url} placeholder="https://yourtoken.io"
                          onChange={e => patchEdit(token.id, { website_url: e.target.value })}
                          className={inputCls} />
                      ) : (
                        <p className="truncate text-xs">{token.website_url ?? '—'}</p>
                      )}
                    </div>

                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Twitter</p>
                      {isDraft && edits ? (
                        <input type="url" value={edits.twitter_url} placeholder="https://twitter.com/yourtoken"
                          onChange={e => patchEdit(token.id, { twitter_url: e.target.value })}
                          className={inputCls} />
                      ) : (
                        <p className="truncate text-xs">{token.twitter_url ?? '—'}</p>
                      )}
                    </div>

                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Telegram</p>
                      {isDraft && edits ? (
                        <input type="text" value={edits.telegram_handle} placeholder="@yourtoken"
                          onChange={e => patchEdit(token.id, { telegram_handle: e.target.value })}
                          className={inputCls} />
                      ) : (
                        <p>{token.telegram_handle ?? '—'}</p>
                      )}
                    </div>

                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">TikTok</p>
                      {isDraft && edits ? (
                        <input type="url" value={edits.tiktok_url} placeholder="https://tiktok.com/@yourtoken"
                          onChange={e => patchEdit(token.id, { tiktok_url: e.target.value })}
                          className={inputCls} />
                      ) : (
                        <p className="truncate text-xs">{token.tiktok_url ?? '—'}</p>
                      )}
                    </div>

                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Instagram</p>
                      {isDraft && edits ? (
                        <input type="url" value={edits.instagram_url} placeholder="https://instagram.com/yourtoken"
                          onChange={e => patchEdit(token.id, { instagram_url: e.target.value })}
                          className={inputCls} />
                      ) : (
                        <p className="truncate text-xs">{token.instagram_url ?? '—'}</p>
                      )}
                    </div>

                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Discord</p>
                      {isDraft && edits ? (
                        <input type="url" value={edits.discord_url} placeholder="https://discord.gg/yourtoken"
                          onChange={e => patchEdit(token.id, { discord_url: e.target.value })}
                          className={inputCls} />
                      ) : (
                        <p className="truncate text-xs">{token.discord_url ?? '—'}</p>
                      )}
                    </div>

                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Communities</p>
                      {isDraft && edits ? (
                        <input type="url" value={edits.communities_url} placeholder="https://..."
                          onChange={e => patchEdit(token.id, { communities_url: e.target.value })}
                          className={inputCls} />
                      ) : (
                        <p className="truncate text-xs">{token.communities_url ?? '—'}</p>
                      )}
                    </div>

                    {/* ── Save row ──────────────────────────────── */}
                    {isDraft && edits && (
                      <div className="col-span-2 sm:col-span-3 flex items-center gap-3 pt-1">
                        <Button size="sm" onClick={() => saveDraft(token)} disabled={isSaving}>
                          {isSaving ? (
                            <span className="flex items-center gap-2">
                              <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                              Saving…
                            </span>
                          ) : 'Save Changes'}
                        </Button>
                        {status === 'success' && (
                          <span className="text-xs text-green-600 dark:text-green-400">Saved</span>
                        )}
                        {status && status !== 'success' && (
                          <span className="text-xs text-destructive">{status}</span>
                        )}
                      </div>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>
      )}
    </div>
  )
}
