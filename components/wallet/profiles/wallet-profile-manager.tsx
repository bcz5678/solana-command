'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { WalletRecord } from '@/lib/types/wallet'
import type { WalletProfile } from '@/lib/types/wallet-profile'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { FieldLabel } from '@/components/ui/field'
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { ImagePlus, X } from 'lucide-react'

const MAX_AVATAR_BYTES = 5 * 1024 * 1024

function maskPubKey(key: string) {
    return `${key.slice(0, 5)}…${key.slice(-5)}`
}

/**
 * Create/edit a per-wallet Pump.fun identity — username, bio, avatar (drag &
 * drop, uploaded to S3 on save), and the two manual setup-status flags. Also
 * lists every wallet's current profile status so picking an already-profiled
 * wallet loads it back in for editing instead of starting blank.
 */
export default function WalletProfileManager() {
    const [wallets, setWallets] = useState<WalletRecord[]>([])
    const [profiles, setProfiles] = useState<WalletProfile[]>([])
    const [loading, setLoading] = useState(true)

    const [walletId, setWalletId]           = useState('')
    const [username, setUsername]           = useState('')
    const [bio, setBio]                     = useState('')
    const [pumpfunSetup, setPumpfunSetup]   = useState(false)
    const [terminalLinked, setTerminalLinked] = useState(false)
    const [existingAvatarUrl, setExistingAvatarUrl] = useState<string | null>(null)

    const [avatarFile, setAvatarFile]       = useState<File | null>(null)
    const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
    const [dragOver, setDragOver]           = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const [saving, setSaving]     = useState(false)
    const [error, setError]       = useState('')
    const [message, setMessage]   = useState('')

    function refreshProfiles() {
        return fetch('/api/wallet-profiles')
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => { if (data) setProfiles((data.profiles ?? []) as WalletProfile[]) })
            .catch(() => {})
    }

    useEffect(() => {
        Promise.all([
            fetch('/api/wallets/explorer').then((r) => (r.ok ? r.json() : null)),
            refreshProfiles(),
        ])
            .then(([walletData]) => {
                if (walletData) setWallets((walletData.wallets ?? []) as WalletRecord[])
            })
            .catch(() => {})
            .finally(() => setLoading(false))
    }, [])

    // Release the object URL whenever it's replaced or the component unmounts.
    useEffect(() => {
        return () => { if (avatarPreview) URL.revokeObjectURL(avatarPreview) }
    }, [avatarPreview])

    const profileByWalletId = useMemo(
        () => new Map(profiles.map((p) => [p.walletId, p])),
        [profiles],
    )

    const walletGroups = useMemo<[string, WalletRecord[]][]>(() => {
        const map: Record<string, WalletRecord[]> = {}
        for (const w of wallets) {
            const key = w.wallet_type ?? 'Other'
            ;(map[key] ??= []).push(w)
        }
        return Object.entries(map)
    }, [wallets])

    function resetForm() {
        setWalletId('')
        setUsername('')
        setBio('')
        setPumpfunSetup(false)
        setTerminalLinked(false)
        setExistingAvatarUrl(null)
        clearAvatarFile()
    }

    function clearAvatarFile() {
        setAvatarFile(null)
        setAvatarPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return null })
        if (fileInputRef.current) fileInputRef.current.value = ''
    }

    function loadWallet(id: string) {
        setWalletId(id)
        setError('')
        setMessage('')
        clearAvatarFile()
        const existing = profileByWalletId.get(id)
        setUsername(existing?.username ?? '')
        setBio(existing?.bio ?? '')
        setPumpfunSetup(existing?.pumpfunSetup ?? false)
        setTerminalLinked(existing?.terminalLinked ?? false)
        setExistingAvatarUrl(existing?.avatarUrl ?? null)
    }

    function handleFiles(files: FileList | null) {
        const file = files?.[0]
        if (!file) return
        if (!file.type.startsWith('image/')) { setError('Avatar must be an image file.'); return }
        if (file.size > MAX_AVATAR_BYTES) { setError(`Avatar must be under ${MAX_AVATAR_BYTES / (1024 * 1024)}MB.`); return }
        setError('')
        setAvatarFile(file)
        setAvatarPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file) })
    }

    async function handleSave() {
        setError('')
        setMessage('')
        if (!walletId) { setError('Select a wallet.'); return }

        setSaving(true)
        try {
            const form = new FormData()
            form.set('walletId', walletId)
            form.set('username', username)
            form.set('bio', bio)
            form.set('pumpfunSetup', String(pumpfunSetup))
            form.set('terminalLinked', String(terminalLinked))
            if (avatarFile) form.set('avatar', avatarFile)

            const res = await fetch('/api/wallet-profiles', { method: 'POST', body: form })
            const result = await res.json().catch(() => ({}))
            if (!res.ok) {
                setError(result.error ?? `HTTP ${res.status}`)
                return
            }
            setMessage('Profile saved.')
            clearAvatarFile()
            if (result.avatarUrl) setExistingAvatarUrl(result.avatarUrl)
            await refreshProfiles()
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setSaving(false)
        }
    }

    async function handlePublish() {
        if (!walletId) return
        setSaving(true)
        setError('')
        setMessage('')
        try {
            const res = await fetch('/api/wallet-profiles/publish', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ walletId }),
            })
            const result = await res.json().catch(() => ({}))
            if (!res.ok) {
                setError(result.error ?? `HTTP ${res.status}`)
                return
            }
            setMessage('Published to Pump.fun.')
            setPumpfunSetup(true)
            await refreshProfiles()
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setSaving(false)
        }
    }

    async function handleDelete() {
        if (!walletId) return
        setSaving(true)
        setError('')
        setMessage('')
        try {
            const res = await fetch(`/api/wallet-profiles?walletId=${encodeURIComponent(walletId)}`, { method: 'DELETE' })
            if (!res.ok) {
                const result = await res.json().catch(() => ({}))
                setError(result.error ?? `HTTP ${res.status}`)
                return
            }
            setMessage('Profile cleared.')
            resetForm()
            await refreshProfiles()
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setSaving(false)
        }
    }

    const selectedWallet = wallets.find((w) => w.id === walletId)
    const hasExistingProfile = !!walletId && profileByWalletId.has(walletId)
    const avatarDisplayUrl = avatarPreview ?? existingAvatarUrl

    if (loading) return <p className="text-sm text-muted-foreground py-4">Loading wallets…</p>

    return (
        <div className="flex flex-col gap-6 lg:flex-row">
            {/* Form */}
            <div className="flex flex-col gap-5 max-w-md w-full">
                <div className="flex flex-col gap-1.5">
                    <FieldLabel>Wallet</FieldLabel>
                    <Select value={walletId} onValueChange={loadWallet}>
                        <SelectTrigger>
                            <SelectValue placeholder="Select a wallet" />
                        </SelectTrigger>
                        <SelectContent>
                            {walletGroups.map(([typeName, group], i) => (
                                <SelectGroup key={typeName}>
                                    {i > 0 && <SelectSeparator />}
                                    <SelectLabel>{typeName}</SelectLabel>
                                    {group.map((w) => {
                                        const p = profileByWalletId.get(w.id)
                                        return (
                                            <SelectItem key={w.id} value={w.id}>
                                                {w.label ? `${w.label} · ` : ''}
                                                {maskPubKey(w.public_key)}
                                                {p?.username ? ` · @${p.username}` : ''}
                                            </SelectItem>
                                        )
                                    })}
                                </SelectGroup>
                            ))}
                        </SelectContent>
                    </Select>
                    {selectedWallet && (
                        <p className="font-mono text-[11px] text-muted-foreground">{selectedWallet.public_key}</p>
                    )}
                </div>

                <div className="flex flex-col gap-1.5">
                    <FieldLabel>Avatar</FieldLabel>
                    <div
                        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
                        onClick={() => fileInputRef.current?.click()}
                        className={[
                            'relative flex h-32 w-32 cursor-pointer flex-col items-center justify-center gap-1.5 self-start rounded-full border-2 border-dashed text-center transition-colors overflow-hidden',
                            dragOver ? 'border-blue-500 bg-blue-500/5' : 'border-border hover:border-blue-400',
                        ].join(' ')}
                    >
                        {avatarDisplayUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={avatarDisplayUrl} alt="Avatar preview" className="size-full object-cover" />
                        ) : (
                            <>
                                <ImagePlus className="size-5 text-muted-foreground" />
                                <span className="px-3 text-[10px] text-muted-foreground">Drag & drop or click</span>
                            </>
                        )}
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => handleFiles(e.target.files)}
                        />
                    </div>
                    {(avatarFile || existingAvatarUrl) && (
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); clearAvatarFile(); setExistingAvatarUrl(null) }}
                            className="flex w-fit items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive transition-colors"
                        >
                            <X className="size-3" /> Remove image
                        </button>
                    )}
                    <p className="max-w-[220px] text-[10px] text-muted-foreground/70">
                        Saved here and shown above, but not pushed to Pump.fun yet — their avatar upload needs an image already hosted on an IPFS/CDN host they accept, which isn&apos;t wired up yet. Username and bio publish fine.
                    </p>
                </div>

                <div className="flex flex-col gap-1.5">
                    <FieldLabel>Username</FieldLabel>
                    <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. moonwalker42" maxLength={64} />
                </div>

                <div className="flex flex-col gap-1.5">
                    <FieldLabel>Bio</FieldLabel>
                    <Textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Short bio for this wallet's Pump.fun identity…" rows={3} maxLength={280} />
                </div>

                <div className="flex flex-col gap-2.5">
                    <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
                        <Checkbox checked={pumpfunSetup} onCheckedChange={(v) => setPumpfunSetup(v === true)} />
                        Set up on Pump.fun
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
                        <Checkbox checked={terminalLinked} onCheckedChange={(v) => setTerminalLinked(v === true)} />
                        Linked on Trade.gg
                    </label>
                </div>

                {error && <p className="text-sm text-destructive">{error}</p>}
                {message && <p className="text-sm text-green-500">{message}</p>}

                <div className="flex items-center gap-2">
                    <Button onClick={handleSave} disabled={saving || !walletId}>
                        {saving ? 'Saving…' : 'Save Profile'}
                    </Button>
                    {hasExistingProfile && (
                        <Button variant="outline" onClick={handleDelete} disabled={saving}>
                            Clear Profile
                        </Button>
                    )}
                </div>

                {hasExistingProfile && (
                    <div className="flex flex-col gap-1.5 border-t border-border pt-4">
                        <Button
                            variant="secondary"
                            onClick={handlePublish}
                            disabled={saving || !profileByWalletId.get(walletId)?.username}
                        >
                            {saving ? 'Publishing…' : 'Publish Username/Bio to Pump.fun'}
                        </Button>
                        <p className="text-[10px] text-muted-foreground">
                            Pushes the saved username &amp; bio live to this wallet's Pump.fun account (signs in as
                            the wallet, no funds involved) and marks &quot;Set up on Pump.fun&quot; once it lands.
                        </p>
                    </div>
                )}
            </div>

            {/* Status list */}
            <div className="flex-1 min-w-0">
                <FieldLabel className="mb-2 block">All Wallet Profiles ({profiles.length})</FieldLabel>
                <div className="w-full overflow-x-auto overflow-y-auto max-h-[560px] rounded-md border">
                    <table className="w-full text-sm border-collapse">
                        <thead className="sticky top-0 z-10 bg-muted">
                            <tr className="border-b text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                <th className="px-3 py-2.5 text-left">Wallet</th>
                                <th className="px-3 py-2.5 text-left">Username</th>
                                <th className="px-3 py-2.5 text-center">PF Setup</th>
                                <th className="px-3 py-2.5 text-center">Terminal</th>
                            </tr>
                        </thead>
                        <tbody>
                            {profiles.length === 0 && (
                                <tr>
                                    <td colSpan={4} className="px-3 py-6 text-center text-sm text-muted-foreground">No wallets found.</td>
                                </tr>
                            )}
                            {profiles.map((p) => (
                                <tr
                                    key={p.walletId}
                                    onClick={() => loadWallet(p.walletId)}
                                    className={[
                                        'border-b cursor-pointer transition-colors',
                                        p.walletId === walletId ? 'bg-blue-500/5' : 'hover:bg-muted/30',
                                    ].join(' ')}
                                >
                                    <td className="px-3 py-2.5">
                                        <div className="flex items-center gap-2">
                                            {p.avatarUrl ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={p.avatarUrl} alt="" className="size-6 shrink-0 rounded-full object-cover" />
                                            ) : (
                                                <span className="size-6 shrink-0 rounded-full bg-muted" />
                                            )}
                                            <div className="min-w-0">
                                                {p.label && <div className="truncate text-xs font-medium text-foreground">{p.label}</div>}
                                                <div className="truncate font-mono text-[11px] text-muted-foreground">{maskPubKey(p.publicKey)}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                                        {p.username ? `@${p.username}` : <span className="opacity-40">—</span>}
                                    </td>
                                    <td className="px-3 py-2.5 text-center">
                                        <span className={p.pumpfunSetup ? 'text-green-500' : 'text-muted-foreground/40'}>●</span>
                                    </td>
                                    <td className="px-3 py-2.5 text-center">
                                        <span className={p.terminalLinked ? 'text-green-500' : 'text-muted-foreground/40'}>●</span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}
