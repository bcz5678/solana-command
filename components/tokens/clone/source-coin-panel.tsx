'use client'

import { useState, RefObject } from 'react'
import { ArrowRight, Download, Loader2 } from 'lucide-react'
import { TokenMint, TokenMetaDTO } from '@/lib/types/token-mint'
import { CreateTokenFormInput } from '@/components/tokens/create/create-token-form'
import type { CreateTokenFormHandle } from '@/components/tokens/create/create-token-form'

// Normalized shape both a DB token row and an on-chain asset lookup get
// mapped into, so the panel doesn't care where the coin came from.
export interface ClonableCoin {
    devWalletId:   string | null
    name:          string | null
    symbol:        string | null
    logoUrl:       string | null
    bannerUrl:     string | null
    description:   string | null
    website:       string | null
    twitter:       string | null
    telegram:      string | null
    tiktok:        string | null
    instagram:     string | null
    discord:       string | null
    coinCommunity: string | null
}

export function clonableCoinFromTokenMint(token: TokenMint): ClonableCoin {
    return {
        devWalletId:   token.dev_wallet_id,
        name:          token.token_name,
        symbol:        token.token_symbol,
        logoUrl:       token.logo_url,
        bannerUrl:     token.banner_url,
        description:   token.description,
        website:       token.website_url,
        twitter:       token.twitter_url,
        telegram:      token.telegram_handle,
        tiktok:        token.tiktok_url,
        instagram:     token.instagram_url,
        discord:       token.discord_url,
        coinCommunity: token.communities_url,
    }
}

// metaData = on-chain SPL token metadata (name/symbol/uri) — used only as a
// fallback for name/symbol. uriData = the JSON at that uri, which follows
// TokenMetaDTO since every token minted through this app uploads that shape.
export function clonableCoinFromOnChainAsset(
    metaData: Record<string, unknown> | null,
    uriData:  Partial<TokenMetaDTO> | null,
): ClonableCoin {
    const meta = metaData ?? {}

    return {
        devWalletId:   null,
        name:          uriData?.name   ?? (typeof meta.name   === 'string' ? meta.name   : null),
        symbol:        uriData?.symbol ?? (typeof meta.symbol === 'string' ? meta.symbol : null),
        logoUrl:       uriData?.image          ?? null,
        bannerUrl:     uriData?.banner         ?? null,
        description:   uriData?.description    ?? null,
        website:       uriData?.website        ?? null,
        twitter:       uriData?.twitter        ?? null,
        telegram:      uriData?.telegram       ?? null,
        tiktok:        uriData?.tiktok         ?? null,
        instagram:     uriData?.instagram      ?? null,
        discord:       uriData?.discord        ?? null,
        coinCommunity: uriData?.coin_community ?? null,
    }
}

type Props = {
    coin:    ClonableCoin
    formRef: RefObject<CreateTokenFormHandle | null>
}

type TextRow = {
    kind:      'text'
    label:     string
    value:     string | null
    formField: keyof CreateTokenFormInput
}

type ImageRow = {
    kind:     'image'
    label:    string
    value:    string | null
    aspect:   'square' | 'wide'
    busy:     boolean
    error:    string | null
    copy:     () => void
    download: () => void
}

type Row = TextRow | ImageRow

async function fetchAsFile(url: string, fallbackName: string): Promise<File> {
    const proxied = `/api/token-mint/fetch-asset?url=${encodeURIComponent(url)}`
    const res = await fetch(proxied)
    if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `Failed to fetch asset (${res.status})`)
    }
    const blob = await res.blob()
    const name = decodeURIComponent(url.split('/').pop() ?? fallbackName)
    return new File([blob], name, { type: blob.type })
}

function triggerDownload(file: File) {
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}

function CopyButton({ disabled, onClick }: { disabled?: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className="shrink-0 inline-flex items-center justify-center rounded-md border border-input size-7 text-muted-foreground transition-colors hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Copy to new token"
            title="Copy to new token"
        >
            <ArrowRight className="size-3.5" />
        </button>
    )
}

function DownloadButton({ disabled, onClick }: { disabled?: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className="shrink-0 inline-flex items-center justify-center rounded-md border border-input size-7 text-muted-foreground transition-colors hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Download image"
            title="Download image"
        >
            <Download className="size-3.5" />
        </button>
    )
}

export default function SourceCoinPanel({ coin, formRef }: Props) {
    const [imageBusy, setImageBusy]     = useState(false)
    const [bannerBusy, setBannerBusy]   = useState(false)
    const [imageError, setImageError]   = useState<string | null>(null)
    const [bannerError, setBannerError] = useState<string | null>(null)

    async function copyImage() {
        if (!coin.logoUrl) return
        setImageBusy(true)
        setImageError(null)
        try {
            const file = await fetchAsFile(coin.logoUrl, `${coin.symbol ?? 'token'}_logo.png`)
            formRef.current?.setLogoFile(file)
        } catch (err) {
            setImageError(err instanceof Error ? err.message : 'Failed to copy image')
        } finally {
            setImageBusy(false)
        }
    }

    async function downloadImage() {
        if (!coin.logoUrl) return
        setImageBusy(true)
        setImageError(null)
        try {
            const file = await fetchAsFile(coin.logoUrl, `${coin.symbol ?? 'token'}_logo.png`)
            triggerDownload(file)
        } catch (err) {
            setImageError(err instanceof Error ? err.message : 'Failed to download image')
        } finally {
            setImageBusy(false)
        }
    }

    async function copyBanner() {
        if (!coin.bannerUrl) return
        setBannerBusy(true)
        setBannerError(null)
        try {
            const file = await fetchAsFile(coin.bannerUrl, `${coin.symbol ?? 'token'}_banner.png`)
            formRef.current?.setBannerFile(file)
        } catch (err) {
            setBannerError(err instanceof Error ? err.message : 'Failed to copy banner')
        } finally {
            setBannerBusy(false)
        }
    }

    async function downloadBanner() {
        if (!coin.bannerUrl) return
        setBannerBusy(true)
        setBannerError(null)
        try {
            const file = await fetchAsFile(coin.bannerUrl, `${coin.symbol ?? 'token'}_banner.png`)
            triggerDownload(file)
        } catch (err) {
            setBannerError(err instanceof Error ? err.message : 'Failed to download banner')
        } finally {
            setBannerBusy(false)
        }
    }

    // Order mirrors CreateTokenForm field order so source rows line up
    // with the destination fields they get copied into.
    const rows: Row[] = [
        { kind: 'text',  label: 'Dev Wallet',     value: coin.devWalletId,   formField: 'creatorWallet' },
        { kind: 'text',  label: 'Name',           value: coin.name,         formField: 'name' },
        { kind: 'text',  label: 'Symbol',         value: coin.symbol,       formField: 'symbol' },
        { kind: 'image', label: 'Logo',           value: coin.logoUrl,      aspect: 'square', busy: imageBusy,   error: imageError,   copy: copyImage,  download: downloadImage },
        { kind: 'image', label: 'Banner',         value: coin.bannerUrl,    aspect: 'wide',   busy: bannerBusy,  error: bannerError,  copy: copyBanner, download: downloadBanner },
        { kind: 'text',  label: 'Description',    value: coin.description, formField: 'description' },
        { kind: 'text',  label: 'Website',        value: coin.website,     formField: 'websiteUrl' },
        { kind: 'text',  label: 'Twitter',        value: coin.twitter,     formField: 'twitterUrl' },
        { kind: 'text',  label: 'Telegram',       value: coin.telegram,    formField: 'telegramHandle' },
        { kind: 'text',  label: 'TikTok',         value: coin.tiktok,      formField: 'tiktokUrl' },
        { kind: 'text',  label: 'Instagram',      value: coin.instagram,   formField: 'instagramUrl' },
        { kind: 'text',  label: 'Discord',        value: coin.discord,     formField: 'discordUrl' },
        { kind: 'text',  label: 'Coin Community', value: coin.coinCommunity, formField: 'communitiesUrl' },
    ]

    return (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Source Coin
            </p>

            {rows.map(row => row.kind === 'image' ? (
                <div key={row.label} className="flex items-center gap-3">
                    {row.value ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={row.value}
                            alt={row.label}
                            className={row.aspect === 'square'
                                ? 'size-12 rounded-md object-cover border border-border shrink-0'
                                : 'w-20 h-8 rounded-md object-cover border border-border shrink-0'}
                        />
                    ) : (
                        <div className={row.aspect === 'square'
                            ? 'size-12 rounded-md border border-dashed border-border shrink-0'
                            : 'w-20 h-8 rounded-md border border-dashed border-border shrink-0'}
                        />
                    )}
                    <div className="flex-1 min-w-0">
                        <p className="text-xs text-muted-foreground">{row.label}</p>
                        {row.error && <p className="text-xs text-destructive">{row.error}</p>}
                    </div>
                    <DownloadButton disabled={!row.value || row.busy} onClick={row.download} />
                    <CopyButton disabled={!row.value || row.busy} onClick={row.copy} />
                    {row.busy && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                </div>
            ) : (
                <div key={row.formField} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                        <p className="text-xs text-muted-foreground">{row.label}</p>
                        <p className="text-sm truncate">{row.value || '—'}</p>
                    </div>
                    <CopyButton
                        disabled={!row.value}
                        onClick={() => row.value && formRef.current?.setField(row.formField, row.value)}
                    />
                </div>
            ))}
        </div>
    )
}
