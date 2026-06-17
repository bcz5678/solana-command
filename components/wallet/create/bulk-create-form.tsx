'use client'

import { useState, useEffect } from 'react'
import { WalletGroupDTO, WalletTypeDTO } from '@/lib/types/wallet'
import { generateWallet } from '@/lib/wallet/generate'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FieldLabel, FieldDescription } from '@/components/ui/field'
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    Combobox,
    ComboboxInput,
    ComboboxContent,
    ComboboxList,
    ComboboxItem,
} from '@/components/ui/combobox'
import { CheckCircle2, XCircle } from 'lucide-react'

type Phase = 'form' | 'creating' | 'done'
type GroupOption = { value: string; label: string }
type BulkResult = {
    index:     number
    label:     string
    publicKey: string
    success:   boolean
    error?:    string
}

export default function BulkCreateForm() {
    const [phase,           setPhase]           = useState<Phase>('form')
    const [walletTypes,     setWalletTypes]     = useState<WalletTypeDTO[]>([])
    const [walletGroups,    setWalletGroups]    = useState<WalletGroupDTO[]>([])
    const [selectedGroup,   setSelectedGroup]   = useState<GroupOption | null>(null)
    const [groupInputValue, setGroupInputValue] = useState('')
    const [walletTypeId,    setWalletTypeId]    = useState('')
    const [labelPrefix,     setLabelPrefix]     = useState('')
    const [count,           setCount]           = useState('10')
    const [password,        setPassword]        = useState('')
    const [confirmPw,       setConfirmPw]       = useState('')
    const [validationErr,   setValidationErr]   = useState('')
    const [progress,        setProgress]        = useState({ current: 0, total: 0 })
    const [results,         setResults]         = useState<BulkResult[]>([])

    useEffect(() => {
        fetch('/api/wallets/create')
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!data) return
                setWalletTypes(data.walletTypes ?? [])
                setWalletGroups(data.walletGroups ?? [])
            })
            .catch(() => {})
    }, [])

    const filteredGroups = walletGroups.filter(g =>
        g.name.toLowerCase().includes(groupInputValue.toLowerCase())
    )
    const exactMatch = walletGroups.some(g =>
        g.name.toLowerCase() === groupInputValue.toLowerCase()
    )
    const showCreate = groupInputValue.trim() !== '' && !exactMatch

    const parsedCount = Math.max(1, Math.min(50, parseInt(count) || 1))
    const showSlowWarning = parsedCount > 20

    async function handleCreate() {
        setValidationErr('')

        if (!walletTypeId)         { setValidationErr('Select a wallet type.'); return }
        if (password.length < 12)  { setValidationErr('Password must be at least 12 characters.'); return }
        if (password !== confirmPw) { setValidationErr('Passwords do not match.'); return }

        let walletGroupId: string | null = null
        let walletGroupName: string | null = null

        if (selectedGroup && selectedGroup.value && selectedGroup.value !== '__new__') {
            walletGroupId = selectedGroup.value
        } else if (groupInputValue.trim()) {
            const existing = walletGroups.find(
                g => g.name.toLowerCase() === groupInputValue.trim().toLowerCase()
            )
            if (existing) {
                walletGroupId = existing.id!
            } else {
                walletGroupName = groupInputValue.trim()
            }
        }

        setPhase('creating')
        setProgress({ current: 0, total: parsedCount })

        // Create the group once before the loop if needed
        if (walletGroupName) {
            const res  = await fetch('/api/wallets/create-group', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ name: walletGroupName }),
            })
            const json = await res.json()
            if (!res.ok) {
                setValidationErr(json.error ?? 'Failed to create wallet group.')
                setPhase('form')
                return
            }
            walletGroupId = json.groupId
        }

        const newResults: BulkResult[] = []

        for (let i = 1; i <= parsedCount; i++) {
            setProgress({ current: i, total: parsedCount })
            const label = labelPrefix.trim() ? `${labelPrefix.trim()} ${i}` : `Wallet ${i}`

            try {
                const wallet = await generateWallet(password)
                // mnemonic intentionally discarded — bulk wallets use password-only recovery

                const res  = await fetch('/api/wallets/create', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({
                        publicKey:       wallet.publicKey,
                        label,
                        chain:           'solana',
                        encryptedSeed:   wallet.encryptedSeed,
                        iv:              wallet.iv,
                        salt:            wallet.salt,
                        vaultSecretName: wallet.vaultSecretName,
                        walletTypeId,
                        walletGroupId,
                    }),
                })
                const json = await res.json()
                if (!res.ok) throw new Error(json.error ?? 'Creation failed')

                newResults.push({ index: i, label, publicKey: wallet.publicKey, success: true })
            } catch (err) {
                newResults.push({
                    index:     i,
                    label,
                    publicKey: '',
                    success:   false,
                    error:     err instanceof Error ? err.message : 'Unknown error',
                })
            }
        }

        setResults(newResults)
        setPhase('done')
    }

    function reset() {
        setPhase('form')
        setResults([])
        setProgress({ current: 0, total: 0 })
        setPassword('')
        setConfirmPw('')
        setValidationErr('')
    }

    // ── Creating ────────────────────────────────────────────────
    if (phase === 'creating') {
        const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0
        return (
            <div className="flex flex-col gap-4 max-w-md">
                <p className="text-sm font-medium">Creating wallets…</p>
                <p className="text-xs text-muted-foreground">
                    {progress.current} of {progress.total} complete
                </p>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                        className="h-full rounded-full bg-primary transition-all duration-200"
                        style={{ width: `${pct}%` }}
                    />
                </div>
                <p className="text-xs text-muted-foreground">Do not close this page.</p>
            </div>
        )
    }

    // ── Done ────────────────────────────────────────────────────
    if (phase === 'done') {
        const succeeded = results.filter(r => r.success).length
        const failed    = results.length - succeeded
        return (
            <div className="flex flex-col gap-4 max-w-2xl">
                <div className={`rounded-md px-4 py-3 text-sm font-semibold ${
                    failed === 0
                        ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                        : 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
                }`}>
                    {succeeded} of {results.length} wallets created
                    {failed > 0 && ` · ${failed} failed`}
                </div>

                <div className="rounded-md border border-border overflow-hidden">
                    <table className="w-full text-xs">
                        <thead className="bg-muted/50">
                            <tr>
                                <th className="text-left px-3 py-2 font-medium text-muted-foreground w-8">#</th>
                                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Label</th>
                                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Public Key</th>
                                <th className="px-3 py-2 w-6" />
                            </tr>
                        </thead>
                        <tbody>
                            {results.map(r => (
                                <tr key={r.index} className="border-t border-border">
                                    <td className="px-3 py-2 text-muted-foreground">{r.index}</td>
                                    <td className="px-3 py-2">{r.label}</td>
                                    <td className="px-3 py-2 font-mono text-muted-foreground">
                                        {r.success
                                            ? `${r.publicKey.slice(0, 8)}…${r.publicKey.slice(-8)}`
                                            : <span className="text-destructive">{r.error}</span>
                                        }
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        {r.success
                                            ? <CheckCircle2 className="size-3.5 text-green-500 inline" />
                                            : <XCircle     className="size-3.5 text-destructive inline" />
                                        }
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <Button variant="outline" size="sm" className="self-start" onClick={reset}>
                    Create More Wallets
                </Button>
            </div>
        )
    }

    // ── Form ────────────────────────────────────────────────────
    return (
        <div className="flex flex-col gap-5 max-w-md">

            {/* Count */}
            <div className="flex flex-col gap-1.5">
                <FieldLabel>Number of Wallets</FieldLabel>
                <Input
                    type="number"
                    min={1}
                    max={50}
                    value={count}
                    onChange={e => setCount(e.target.value)}
                    className="w-28"
                />
                {showSlowWarning && (
                    <p className="text-xs text-yellow-600 dark:text-yellow-400">
                        Creating {parsedCount} wallets may take several minutes due to key derivation.
                    </p>
                )}
            </div>

            {/* Label prefix */}
            <div className="flex flex-col gap-1.5">
                <FieldLabel>Label Prefix</FieldLabel>
                <Input
                    placeholder="e.g. Volume Bot"
                    value={labelPrefix}
                    onChange={e => setLabelPrefix(e.target.value)}
                />
                <FieldDescription className="italic">
                    Wallets will be labeled &ldquo;{labelPrefix || 'Wallet'} 1&rdquo;, &ldquo;{labelPrefix || 'Wallet'} 2&rdquo;, etc.
                </FieldDescription>
            </div>

            {/* Wallet group */}
            <div className="flex flex-col gap-1.5">
                <FieldLabel>Wallet Group</FieldLabel>
                <Combobox<GroupOption>
                    value={selectedGroup}
                    onValueChange={opt => setSelectedGroup(opt)}
                    inputValue={groupInputValue}
                    onInputValueChange={val => {
                        setGroupInputValue(val)
                        if (selectedGroup && val !== selectedGroup.label) setSelectedGroup(null)
                    }}
                    filter={null}
                    isItemEqualToValue={(a, b) => a.value === b.value}
                >
                    <ComboboxInput showClear placeholder="Select or create wallet group..." />
                    <ComboboxContent>
                        <ComboboxList>
                            {filteredGroups.map(g => (
                                <ComboboxItem key={g.id} value={{ value: g.id!, label: g.name }}>
                                    {g.name}
                                </ComboboxItem>
                            ))}
                            {showCreate && (
                                <ComboboxItem value={{ value: '__new__', label: groupInputValue }}>
                                    Create &quot;{groupInputValue}&quot;
                                </ComboboxItem>
                            )}
                            {filteredGroups.length === 0 && !showCreate && (
                                <p className="py-2 text-center text-sm text-muted-foreground">
                                    {groupInputValue ? 'No groups found' : 'No groups yet'}
                                </p>
                            )}
                        </ComboboxList>
                    </ComboboxContent>
                </Combobox>
            </div>

            {/* Wallet type */}
            <div className="flex flex-col gap-1.5">
                <FieldLabel>Wallet Type</FieldLabel>
                <Select value={walletTypeId} onValueChange={setWalletTypeId}>
                    <SelectTrigger>
                        <SelectValue placeholder="Select wallet type" />
                    </SelectTrigger>
                    <SelectContent position="popper">
                        <SelectGroup>
                            {walletTypes.map(wt => (
                                <SelectItem key={wt.id} value={wt.id!}>
                                    {wt.name}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </div>

            {/* Password */}
            <div className="flex flex-col gap-1.5">
                <FieldLabel>Encryption Password</FieldLabel>
                <Input
                    type="password"
                    placeholder="Min 12 characters"
                    autoComplete="new-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                />
                <FieldDescription className="italic">
                    One password encrypts all wallets. Seed phrases are not displayed — recovery is password-only.
                </FieldDescription>
            </div>

            {/* Confirm password */}
            <div className="flex flex-col gap-1.5">
                <FieldLabel>Confirm Password</FieldLabel>
                <Input
                    type="password"
                    placeholder="Repeat password"
                    autoComplete="new-password"
                    value={confirmPw}
                    onChange={e => setConfirmPw(e.target.value)}
                />
            </div>

            {validationErr && (
                <p className="text-sm text-destructive">{validationErr}</p>
            )}

            <Button size="lg" onClick={handleCreate}>
                Create {parsedCount} Wallet{parsedCount !== 1 ? 's' : ''}
            </Button>
        </div>
    )
}
