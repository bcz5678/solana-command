'use client'

import { useState, useEffect } from "react";
import type { WalletRecord } from "@/lib/types/wallet";
import { useForm, Controller, SubmitHandler } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { FieldLabel, FieldDescription } from "@/components/ui/field";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    DialogClose,
} from "@/components/ui/dialog";

type WalletTypeRow  = { id: string; name: string };
type WalletOwnerRow = { wallet_id: string; wallet_type_id: string | null };

interface TransferFormInput {
    senderWalletAddress: string;
    receiverWalletAddress: string;
    amountSOL: number;
}

function truncate(key: string) {
    return `${key.slice(0, 8)}...${key.slice(-8)}`;
}

export default function TransferForm() {
    const [wallets, setWallets]           = useState<WalletRecord[]>([]);
    const [typeById, setTypeById]         = useState<Record<string, string>>({});
    const [ownerTypeMap, setOwnerTypeMap] = useState<Record<string, string>>({});
    const [submitStatus, setSubmitStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [statusMessage, setStatusMessage] = useState('');
    const [pending, setPending] = useState<TransferFormInput | null>(null);

    const walletGroups: [string, WalletRecord[]][] = Object.entries(
        wallets.reduce<Record<string, WalletRecord[]>>((acc, w) => {
            const key = w.wallet_type
                ?? (ownerTypeMap[w.id] ? typeById[ownerTypeMap[w.id]] : null)
                ?? 'Other';
            (acc[key] ??= []).push(w);
            return acc;
        }, {})
    );

    const { handleSubmit, control, register, watch, formState: { errors } } = useForm<TransferFormInput>();

    useEffect(() => {
        fetch('/api/wallets/explorer')
            .then((r) => {
                if (!r.ok) {
                    r.json().then(body => console.error('[wallets] API error', r.status, body));
                    return;
                }
                return r.json();
            })
            .then((data) => {
                if (!data) return;
                if (data.wallets)     setWallets(data.wallets);
                if (data.walletTypes) setTypeById(Object.fromEntries(data.walletTypes.map((t: WalletTypeRow) => [t.id, t.name])));
                if (data.owners)      setOwnerTypeMap(Object.fromEntries(data.owners.filter((o: WalletOwnerRow) => o.wallet_type_id).map((o: WalletOwnerRow) => [o.wallet_id, o.wallet_type_id!])));
            })
            .catch(err => console.error('[wallets] fetch failed', err));
    }, []);

    const senderValue = watch('senderWalletAddress');

    const onSubmit: SubmitHandler<TransferFormInput> = (data) => {
        if (data.senderWalletAddress === data.receiverWalletAddress) {
            setSubmitStatus('error');
            setStatusMessage('Sender and receiver cannot be the same wallet.');
            return;
        }
        setSubmitStatus('idle');
        setStatusMessage('');
        setPending(data);
    };

    const executeTransfer = async () => {
        if (!pending) return;
        setSubmitStatus('loading');
        setPending(null);

        const params = new URLSearchParams({
            senderWalletAddress: pending.senderWalletAddress,
            receiverWalletAddress: pending.receiverWalletAddress,
            amountSOL: String(pending.amountSOL),
        });

        const res = await fetch(`/api/wallet/transfer?${params}`);
        if (res.ok) {
            setSubmitStatus('success');
            setStatusMessage('Transfer submitted successfully.');
        } else {
            setSubmitStatus('error');
            setStatusMessage('Transfer failed. Please try again.');
        }
    };

    return (
        <>
            <form onSubmit={handleSubmit(onSubmit)}>
                <div className="mt-4">
                    <FieldLabel htmlFor="input-sender" className="mb-2">Sender Wallet</FieldLabel>
                    <Controller
                        name="senderWalletAddress"
                        control={control}
                        rules={{ required: "Sender wallet is required" }}
                        render={({ field }) => (
                            <Select onValueChange={field.onChange} value={field.value ?? ""}>
                                <SelectTrigger id="input-sender">
                                    <SelectValue placeholder="Select sender wallet" />
                                </SelectTrigger>
                                <SelectContent>
                                    {walletGroups.map(([typeName, group], i) => (
                                        <SelectGroup key={typeName}>
                                            {i > 0 && <SelectSeparator />}
                                            <SelectLabel>{typeName}</SelectLabel>
                                            {group.map((w) => (
                                                <SelectItem key={w.id} value={w.public_key}>
                                                    {w.label ? `${w.label} · ${truncate(w.public_key)}` : truncate(w.public_key)}
                                                </SelectItem>
                                            ))}
                                        </SelectGroup>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    />
                    {errors.senderWalletAddress && (
                        <p className="mt-1 text-sm text-destructive">{errors.senderWalletAddress.message}</p>
                    )}
                </div>

                <div className="mt-4">
                    <FieldLabel htmlFor="input-receiver" className="mb-2">Receiver Wallet</FieldLabel>
                    <Controller
                        name="receiverWalletAddress"
                        control={control}
                        rules={{ required: "Receiver wallet is required" }}
                        render={({ field }) => (
                            <Select onValueChange={field.onChange} value={field.value ?? ""}>
                                <SelectTrigger id="input-receiver">
                                    <SelectValue placeholder="Select receiver wallet" />
                                </SelectTrigger>
                                <SelectContent>
                                    {walletGroups.map(([typeName, group], i) => {
                                        const filtered = group.filter((w) => w.public_key !== senderValue);
                                        if (!filtered.length) return null;
                                        return (
                                            <SelectGroup key={typeName}>
                                                {i > 0 && <SelectSeparator />}
                                                <SelectLabel>{typeName}</SelectLabel>
                                                {filtered.map((w) => (
                                                    <SelectItem key={w.id} value={w.public_key}>
                                                        {w.label ? `${w.label} · ${truncate(w.public_key)}` : truncate(w.public_key)}
                                                    </SelectItem>
                                                ))}
                                            </SelectGroup>
                                        );
                                    })}
                                </SelectContent>
                            </Select>
                        )}
                    />
                    {errors.receiverWalletAddress && (
                        <p className="mt-1 text-sm text-destructive">{errors.receiverWalletAddress.message}</p>
                    )}
                </div>

                <div className="mt-4">
                    <FieldLabel htmlFor="input-amount" className="mb-2">Amount (SOL)</FieldLabel>
                    <InputGroup className="mt-2 mb-1">
                        <InputGroupInput
                            {...register("amountSOL", {
                                required: "Amount is required",
                                valueAsNumber: true,
                                min: { value: 0.000000001, message: "Amount must be greater than 0" },
                            })}
                            id="input-amount"
                            type="number"
                            step="any"
                            placeholder="0.00"
                        />
                    </InputGroup>
                    {errors.amountSOL && (
                        <p className="mt-1 text-sm text-destructive">{errors.amountSOL.message}</p>
                    )}
                    <FieldDescription className="italic">Up to 9 decimal places</FieldDescription>
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
                            Transferring...
                        </span>
                    ) : 'Transfer'}
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

            <Dialog open={!!pending} onOpenChange={(open) => { if (!open) setPending(null); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Confirm Transfer</DialogTitle>
                        <DialogDescription>Review the details before sending.</DialogDescription>
                    </DialogHeader>

                    {pending && (
                        <div className="grid gap-2 text-sm">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">From</span>
                                <span className="font-mono">{truncate(pending.senderWalletAddress)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">To</span>
                                <span className="font-mono">{truncate(pending.receiverWalletAddress)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Amount</span>
                                <span className="font-semibold">{pending.amountSOL} SOL</span>
                            </div>
                        </div>
                    )}

                    <DialogFooter>
                        <DialogClose asChild>
                            <Button variant="outline">Cancel</Button>
                        </DialogClose>
                        <Button variant="default" onClick={executeTransfer}>
                            Confirm Transfer
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
