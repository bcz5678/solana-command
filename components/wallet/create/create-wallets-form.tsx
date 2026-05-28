'use client'

import { useState, useEffect } from "react";

import { Skeleton } from '@/components/ui/skeleton';
import {
    useForm,
    SubmitHandler,
    Controller,
} from "react-hook-form"
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    FieldDescription,
    FieldLabel,
} from "@/components/ui/field"
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Combobox,
    ComboboxInput,
    ComboboxContent,
    ComboboxList,
    ComboboxItem,
} from "@/components/ui/combobox"
import { WalletGroupDTO, WalletTypeDTO } from '@/app/db/models/wallet'
import { generateWallet } from '@/lib/wallet/generate'

type Step = 'form' | 'mnemonic' | 'done'
type GroupOption = { value: string; label: string };  // ← uuid string not number

interface CreateWalletsFormInput {
    label:      string
    walletType: string   // ← uuid string not number
    password:   string
    confirm:    string
}

export default function CreateWalletsForm() {
    const [step,        setStep]        = useState<Step>('form')
    const [mnemonic,    setMnemonic]    = useState('')
    const [walletId,    setWalletId]    = useState('')
    const [walletTypes, setWalletTypes] = useState<WalletTypeDTO[]>([])
    const [walletGroups, setWalletGroups] = useState<WalletGroupDTO[]>([])
    const [selectedGroup, setSelectedGroup] = useState<GroupOption | null>(null)
    const [groupInputValue, setGroupInputValue] = useState('')
    const [submitStatus, setSubmitStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
    const [statusMessage, setStatusMessage] = useState('')

    const filteredGroups = walletGroups.filter(g =>
        g.name.toLowerCase().includes(groupInputValue.toLowerCase())
    )
    const exactMatch = walletGroups.some(g =>
        g.name.toLowerCase() === groupInputValue.toLowerCase()
    )
    const showCreate = groupInputValue.trim() !== '' && !exactMatch

    const { handleSubmit, control, register, formState: { errors } } = useForm<CreateWalletsFormInput>()

    const onSubmit: SubmitHandler<CreateWalletsFormInput> = async (data) => {
        if (data.password !== data.confirm) {
            setSubmitStatus('error')
            setStatusMessage('Passwords do not match.')
            return
        }
        if (data.password.length < 12) {
            setSubmitStatus('error')
            setStatusMessage('Password must be at least 12 characters.')
            return
        }

        let walletGroupId: string | null = null   // ← uuid string not number
        let walletGroupName: string | null = null

        if (selectedGroup && selectedGroup.value !== '0') {
            walletGroupId = selectedGroup.value    // ← already a uuid string
        } else if (groupInputValue.trim()) {
            const existing = walletGroups.find(
                g => g.name.toLowerCase() === groupInputValue.trim().toLowerCase()
            )
            if (existing) {
                walletGroupId = existing.id!       // ← uuid string from DB
            } else {
                walletGroupName = groupInputValue.trim()
            }
        }

        setSubmitStatus('loading')
        setStatusMessage('')

        try {
            const wallet = await generateWallet(data.password)

            const res = await fetch('/api/wallets/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    publicKey:       wallet.publicKey,
                    label:           data.label,
                    chain:           'solana',
                    encryptedSeed:   wallet.encryptedSeed,
                    iv:              wallet.iv,
                    salt:            wallet.salt,
                    vaultSecretName: wallet.vaultSecretName,
                    walletTypeId:    data.walletType || null,   // ← uuid string directly
                    walletGroupId,
                    walletGroupName,
                }),
            })

            const json = await res.json()

            if (!res.ok) {
                setSubmitStatus('error')
                setStatusMessage(json.error ?? 'Failed to create wallet.')
            } else {
                setWalletId(json.walletId)
                setMnemonic(wallet.mnemonic)
                setSubmitStatus('idle')
                setStep('mnemonic')
            }
        } catch (err) {
            setSubmitStatus('error')
            setStatusMessage((err as Error).message)
        }
    }

    function handleMnemonicConfirmed() {
        setMnemonic('')
        setStep('done')
    }

    useEffect(() => {
        fetch('/api/wallets/create')
            .then(async (r) => {
                const json = await r.json()
                if (!r.ok) {
                    setSubmitStatus('error')
                    setStatusMessage(json.error ?? 'Failed to load form data')
                    return
                }
                setWalletTypes(json.walletTypes ?? [])
                setWalletGroups(json.walletGroups ?? [])
            })
    }, [])

    // ── Mnemonic step ───────────────────────────────────────────
    if (step === 'mnemonic') return (
        <div className="grid grid-cols-3 gap-4">
            <div className="col-span-3 rounded-md border border-yellow-400/50 bg-yellow-500/10 p-5">
                <h2 className="mb-1 text-base font-semibold text-yellow-600 dark:text-yellow-400">
                    Save your recovery phrase
                </h2>
                <p className="mb-4 text-sm text-muted-foreground">
                    Write these 24 words down. This is the only time they will be shown.
                    Losing this phrase means losing recovery access permanently.
                </p>
                <div className="mb-5 grid grid-cols-4 gap-2 rounded-md bg-muted/60 p-4 font-mono text-sm">
                    {mnemonic.split(' ').map((word, i) => (
                        <span key={i} className="flex gap-1">
                            <sup className="text-muted-foreground">{i + 1}</sup>
                            {word}
                        </span>
                    ))}
                </div>
                <Button variant="default" size="lg" onClick={handleMnemonicConfirmed}>
                    I have written down my recovery phrase
                </Button>
            </div>
        </div>
    )

    // ── Done step ───────────────────────────────────────────────
    if (step === 'done') return (
        <div className="grid grid-cols-3 gap-4">
            <div className="col-span-3 flex items-start gap-3 rounded-md bg-green-500/10 px-4 py-4">
                <svg className="mt-0.5 size-5 shrink-0 text-green-600 dark:text-green-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <div>
                    <p className="font-semibold text-green-600 dark:text-green-400">Wallet created</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                        Wallet ID: <code className="font-mono">{walletId}</code>
                    </p>
                </div>
            </div>
            <Button
                variant="outline"
                onClick={() => {
                    setStep('form')
                    setWalletId('')
                    setSelectedGroup(null)
                    setGroupInputValue('')
                    setSubmitStatus('idle')
                    setStatusMessage('')
                }}
            >
                Create another wallet
            </Button>
        </div>
    )

    // ── Form step ───────────────────────────────────────────────
    return (
        <div className="grid grid-cols-3 gap-4">
            <form onSubmit={handleSubmit(onSubmit)}>
                <div className="mt-4">
                    <FieldLabel htmlFor="input-wallet-label" className="mb-2">
                        Wallet Label
                    </FieldLabel>
                    <Input
                        id="input-wallet-label"
                        placeholder="e.g. Trading wallet #1"
                        {...register('label', { required: true })}
                    />
                    {errors.label && (
                        <p className="mt-1 text-xs text-destructive">Label is required.</p>
                    )}
                </div>

                <div className="mt-4">
                    <FieldLabel htmlFor="input-wallet-group" className="mb-2">
                        Wallet Group
                    </FieldLabel>
                    <Combobox<GroupOption>
                        value={selectedGroup}
                        onValueChange={(opt) => setSelectedGroup(opt)}
                        inputValue={groupInputValue}
                        onInputValueChange={(val) => {
                            setGroupInputValue(val)
                            if (selectedGroup && val !== selectedGroup.label) {
                                setSelectedGroup(null)
                            }
                        }}
                        filter={null}
                        isItemEqualToValue={(a, b) => a.value === b.value}
                    >
                        <ComboboxInput
                            id="input-wallet-group"
                            showClear
                            placeholder="Select or create wallet group..."
                        />
                        <ComboboxContent>
                            <ComboboxList>
                                {filteredGroups.map(g => (
                                    <ComboboxItem
                                        key={g.id}
                                        value={{ value: g.id!, label: g.name }}
                                    >
                                        {g.name}
                                    </ComboboxItem>
                                ))}
                                {showCreate && (
                                    <ComboboxItem value={{ value: '', label: groupInputValue }}>
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
                    <FieldDescription className="italic">
                        Assign wallets to an existing group or type a new name to create one.
                    </FieldDescription>
                </div>

                <div className="mt-4">
                    <FieldLabel htmlFor="input-wallet-type" className="mb-2">
                        Wallet Type
                    </FieldLabel>
                    <Controller
                        name="walletType"
                        control={control}
                        rules={{ required: true }}
                        render={({ field }) => (
                            <Select
                                onValueChange={(value) => field.onChange(value)}  // ← uuid string, no Number()
                                value={field.value ?? undefined}
                            >
                                <SelectTrigger id="input-wallet-type">
                                    <SelectValue placeholder="Select wallet type" />
                                </SelectTrigger>
                                <SelectContent position="popper">
                                    <SelectGroup>
                                        {walletTypes.map((wt) => (
                                            <SelectItem key={wt.id} value={wt.id!}>
                                                {wt.name}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        )}
                    />
                </div>

                <div className="mt-4">
                    <FieldLabel htmlFor="input-password" className="mb-2">
                        Encryption Password
                    </FieldLabel>
                    <Input
                        id="input-password"
                        type="password"
                        placeholder="Min 12 characters"
                        autoComplete="new-password"
                        {...register('password', { required: true, minLength: 12 })}
                    />
                    {errors.password && (
                        <p className="mt-1 text-xs text-destructive">Password must be at least 12 characters.</p>
                    )}
                    <FieldDescription className="italic">
                        Used to encrypt your recovery phrase. Never sent to the server.
                    </FieldDescription>
                </div>

                <div className="mt-4">
                    <FieldLabel htmlFor="input-confirm" className="mb-2">
                        Confirm Password
                    </FieldLabel>
                    <Input
                        id="input-confirm"
                        type="password"
                        placeholder="Repeat password"
                        autoComplete="new-password"
                        {...register('confirm', { required: true })}
                    />
                </div>

                <Button
                    className="mt-4"
                    size="lg"
                    variant="default"
                    type="submit"
                    disabled={submitStatus === 'loading'}
                >
                    {submitStatus === 'loading' ? (
                        <span className="flex items-center gap-2">
                            <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                            Creating...
                        </span>
                    ) : 'Create Wallet KeyPair'}
                </Button>

                {submitStatus === 'error' && (
                    <div className="mt-3 flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        <svg className="size-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                        {statusMessage}
                    </div>
                )}
            </form>
        </div>
    )
}
