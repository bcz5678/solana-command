'use client'

import { useState, useEffect }  from "react";

import { Skeleton } from '@/components/ui/skeleton';

import {
    useForm,
    SubmitHandler,
    Controller,
} from "react-hook-form"
import { Button } from "@/components/ui/button";
import {
    InputGroup,
    InputGroupInput
} from '@/components/ui/input-group';
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
import { OwnerDTO, WalletGroupDTO, WalletTypeDTO } from '@/app/db/models/wallet'

type GroupOption = { value: number; label: string };

interface CreateWalletsFormInput {
    numberOfWallets: number,
    walletType: number,
    ownerID: number,
}



export default function CreateWalletsForm(){
    const [walletTypes, setWalletTypes] = useState<WalletTypeDTO[]>([]);
    const [owners, setOwners] = useState<OwnerDTO[]>([]);
    const [walletGroups, setWalletGroups] = useState<WalletGroupDTO[]>([]);
    const [selectedGroup, setSelectedGroup] = useState<GroupOption | null>(null);
    const [groupInputValue, setGroupInputValue] = useState('');
    const [submitStatus, setSubmitStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [statusMessage, setStatusMessage] = useState('');
      const [loading, setLoading] = useState<boolean>(true);

    const filteredGroups = walletGroups.filter(g =>
        g.name.toLowerCase().includes(groupInputValue.toLowerCase())
    );
    const exactMatch = walletGroups.some(g =>
        g.name.toLowerCase() === groupInputValue.toLowerCase()
    );
    const showCreate = groupInputValue.trim() !== '' && !exactMatch;

    const { register, handleSubmit, control } = useForm<CreateWalletsFormInput>();
    const onSubmit: SubmitHandler<CreateWalletsFormInput> = async (data) => {
        let groupId: number | null = null
        let groupName: string | null = null

        if (selectedGroup && selectedGroup.value !== 0) {
            groupId = selectedGroup.value
        } else if (groupInputValue.trim()) {
            const existing = walletGroups.find(
                g => g.name.toLowerCase() === groupInputValue.trim().toLowerCase()
            )
            if (existing) {
                groupId = existing.id!
            } else {
                groupName = groupInputValue.trim()
            }
        } else {
            setSubmitStatus('error')
            setStatusMessage('Please select or enter a wallet group.')
            return
        }

        setSubmitStatus('loading')
        setStatusMessage('')

        const res = await fetch('/api/wallets/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                numberOfWallets: data.numberOfWallets,
                walletType:      data.walletType,
                ownerID:         data.ownerID,
                groupId,
                groupName,
            }),
        })

        const json = await res.json()

        if (!res.ok) {
            setSubmitStatus('error')
            setStatusMessage(json.error ?? 'Failed to create wallets')
        } else {
            setSubmitStatus('success')
            setStatusMessage(`${json.count} wallet${json.count !== 1 ? 's' : ''} created successfully.`)
        }
    }

    useEffect(() => {
        fetch('/api/wallets/setup')
            .then((r) => r.json())
            .then(({ owners, walletTypes, walletGroups }) => {
                setOwners(owners ?? [])
                setWalletTypes(walletTypes ?? [])
                setWalletGroups(walletGroups ?? [])
            })
    }, [])


    return(
        <div className="grid grid-cols-3 gap-4">
            <form onSubmit={handleSubmit(onSubmit)}>
                <div className="mt-4">
                    <FieldLabel htmlFor="input-number-of-wallets">
                        Number of Wallets to Create
                    </FieldLabel>
                    <InputGroup className="mt-2 mb-1">
                        <InputGroupInput
                            { ...register("numberOfWallets", {required: true, min: 1, max: 20})}
                            id="input-number-of-wallets"
                            name ="numberOfWallets"
                            type = "number"

                        />
                    </InputGroup>
                    <FieldDescription className="italic">
                        Number of wallet keypairs to create. Max is 20 per pool (for jito bundling).
                    </FieldDescription>
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
                            setGroupInputValue(val);
                            if (selectedGroup && val !== selectedGroup.label) {
                                setSelectedGroup(null);
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
                                    <ComboboxItem value={{ value: 0, label: groupInputValue }}>
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
                    <FieldLabel
                        htmlFor="input-wallet-type"
                        className="mb-2"
                    >
                        Wallet Type
                    </FieldLabel>
                    <Controller
                        name="walletType"
                        control={control}
                        rules={{ required: true }}
                        render={({ field }) => (
                            <Select
                                onValueChange={(value) => field.onChange(Number(value))}
                                value={field.value !== undefined ? String(field.value) : ""}
                            >
                                <SelectTrigger id="input-wallet-type">
                                    <SelectValue placeholder="Select wallet type" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {walletTypes.map((wt) => (
                                            <SelectItem key={wt.id} value={String(wt.id)}>
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
                    <FieldLabel
                        htmlFor="input-owner"
                        className="mb-2"
                    >
                        Owner
                    </FieldLabel>
                    <Controller
                        name="ownerID"
                        control={control}
                        rules={{ required: true }}
                        render={({ field }) => (
                            <Select
                                onValueChange={(value) => field.onChange(Number(value))}
                                value={field.value !== undefined ? String(field.value) : ""}
                            >
                                <SelectTrigger id="input-owner">
                                    <SelectValue placeholder="Select owner" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {owners.map((o) => (
                                            <SelectItem key={o.id} value={String(o.id)}>
                                                {o.name}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        )}
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
                    ) : 'Create Wallet KeyPairs'}
                </Button>

                {submitStatus === 'success' && (
                    <div className="mt-3 flex items-center gap-2 rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-600 dark:text-green-400">
                        <svg className="size-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        {statusMessage}
                    </div>
                )}

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

    );
}
