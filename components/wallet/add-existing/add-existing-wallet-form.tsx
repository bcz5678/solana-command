'use client'

import { useState, useEffect }  from "react";

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
import { createClient } from '@/lib/supabase/client';
import { getOwners, getWalletGroups, getWalletTypes } from '@/modules/wallets-db';

const supabase = createClient();

function walletInsertErrorMessage(error: { code?: string; details?: string }): string {
    switch (error.code) {
        case '23505':
            return error.details?.includes('private_key')
                ? "A wallet with this private key already exists."
                : "A wallet with this public key already exists.";
        case '23503':
            return "A selected option (owner, type, or group) no longer exists. Please refresh and try again.";
        case '23502':
            return "A required field is missing. Please fill in all fields and try again.";
        case '23514':
            return "One or more values are invalid. Please check your inputs and try again.";
        case '42501':
            return "You don't have permission to add wallets.";
        default:
            return "Something went wrong while adding the wallet. Please try again.";
    }
}

type GroupOption = { value: number; label: string };

interface CreateWalletsFormInput {
    publicKey: string,
    privateKey: string,
    funded: boolean,
    walletType: number,
    ownerID: number,
}



export default function AddExistingWalletForm(){
    const [walletTypes, setWalletTypes] = useState<WalletTypeDTO[]>([]);
    const [owners, setOwners] = useState<OwnerDTO[]>([]);
    const [walletGroups, setWalletGroups] = useState<WalletGroupDTO[]>([]);
    const [selectedGroup, setSelectedGroup] = useState<GroupOption | null>(null);
    const [groupInputValue, setGroupInputValue] = useState('');
    const [submitStatus, setSubmitStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [statusMessage, setStatusMessage] = useState('');

    const filteredGroups = walletGroups.filter(g =>
        g.name.toLowerCase().includes(groupInputValue.toLowerCase())
    );
    const exactMatch = walletGroups.some(g =>
        g.name.toLowerCase() === groupInputValue.toLowerCase()
    );
    const showCreate = groupInputValue.trim() !== '' && !exactMatch;

    const { register, handleSubmit, control, formState: { errors } } = useForm<CreateWalletsFormInput>();
    const onSubmit: SubmitHandler<CreateWalletsFormInput> = async (data) => {
        let groupId: number | null = null;

        if (selectedGroup && selectedGroup.value !== 0) {
            groupId = selectedGroup.value;
        } else if (groupInputValue.trim()) {
            const existingGroup = walletGroups.find(
                g => g.name.toLowerCase() === groupInputValue.trim().toLowerCase()
            );
            if (existingGroup) {
                groupId = existingGroup.id!;
            } else {
                const { data: newGroup, error } = await supabase
                    .from('wallet_groups')
                    .insert({ name: groupInputValue.trim(), owner_id: data.ownerID })
                    .select('id')
                    .single();
                if (error) {
                    setSubmitStatus('error');
                    setStatusMessage(`Failed to create wallet group: ${error.message}`);
                    return;
                }
                groupId = newGroup.id;
            }
        } else {
            setSubmitStatus('error');
            setStatusMessage('Please select or enter a wallet group.');
            return;
        }

        if (groupId != null) {
            setSubmitStatus('loading');
            setStatusMessage('');
            
            const {data: wallets, error } = await supabase
                .from('wallets')
                .insert([{ 
                    public_key: data.publicKey, 
                    private_key: data.privateKey,
                    funded: data.funded,
                    wallet_type_id: data.walletType,
                    owner_id: data.ownerID,
                    group_id: groupId, 
                }])
                .select()

            if (error) {
                setSubmitStatus('error');
                setStatusMessage(walletInsertErrorMessage(error));
            } else {
                setSubmitStatus('success');
                setStatusMessage(`Wallet added succesfully`);
            }
        }
    }

    useEffect(() => {
        getOwners(supabase).then(setOwners);
        getWalletTypes(supabase).then(setWalletTypes);
        getWalletGroups(supabase).then(setWalletGroups);
    },[]);





    return(
        <div className="grid grid-cols-3 gap-4">
            <form onSubmit={handleSubmit(onSubmit)}>
                <div className="mt-4">
                    <FieldLabel htmlFor="input-public-key">
                        Public Key
                    </FieldLabel>
                    <InputGroup className="mt-2 mb-1">
                        <InputGroupInput
                            { ...register("publicKey", {
                                required: "Public key is required",
                                pattern: {
                                    value: /^[a-z0-9]{44}$/i,
                                    message: "Public key must be exactly 44 alphanumeric characters",
                                },
                            })}
                            id="input-public-key"
                            name ="publicKey"
                            type = "string"

                        />
                    </InputGroup>
                    {errors.publicKey && (
                        <p className="mt-1 text-sm text-destructive">{errors.publicKey.message}</p>
                    )}
                    <FieldDescription className="italic">
                        Existing Wallet Public Key
                    </FieldDescription>
                </div>
                <div className="mt-4">
                    <FieldLabel htmlFor="input-private-key">
                        Private Key
                    </FieldLabel>
                    <InputGroup className="mt-2 mb-1">
                        <InputGroupInput
                            { ...register("privateKey", {
                                required: "Private key is required",
                                validate: (value) => {
                                    const parts = value.split(',');
                                    if (parts.length !== 64) return "Private key must contain exactly 64 comma-delimited values";
                                    const valid = parts.every(p => {
                                        const n = Number(p.trim());
                                        return /^\d{1,3}$/.test(p.trim()) && Number.isInteger(n) && n >= 0 && n <= 255;
                                    });
                                    return valid || "Each value must be an integer between 0 and 255";
                                },
                            })}
                            id="input-private-key"
                            name ="privateKey"
                            type = "string"

                        />
                    </InputGroup>
                    {errors.privateKey && (
                        <p className="mt-1 text-sm text-destructive">{errors.privateKey.message}</p>
                    )}
                    <FieldDescription className="italic">
                        Existing Wallet Private Key (64 comma-delimited bytes)
                    </FieldDescription>
                </div>

                <div className="mt-4">
                    <FieldLabel htmlFor="input-funded" className="mb-2">
                        Funded
                    </FieldLabel>
                    <Controller
                        name="funded"
                        control={control}
                        rules={{ required: "Funded is required" }}
                        render={({ field }) => (
                            <Select
                                onValueChange={(value) => field.onChange(value === 'true')}
                                value={field.value !== undefined ? String(field.value) : ""}
                            >
                                <SelectTrigger id="input-funded">
                                    <SelectValue placeholder="Select funded state" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        <SelectItem value="true">Funded</SelectItem>
                                        <SelectItem value="false">Not Funded</SelectItem>
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        )}
                    />
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
                        rules={{ required: "Wallet Type is required" }}
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
                        rules={{ required: "Owner is required" }}
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
                            Adding...
                        </span>
                    ) : 'Add Wallet'}
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
