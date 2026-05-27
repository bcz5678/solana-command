'use client'

import { createClient } from '@/lib/supabase/client';
import { useState, useRef, useEffect } from "react";
import { useForm, Controller, SubmitHandler } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupInput } from '@/components/ui/input-group';
import { FieldDescription, FieldLabel } from "@/components/ui/field";
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


type WalletType = { id: number; name: string };
type Wallet = { id: number; public_key: string; wallet_type_id: number };

export interface CreateTokenFormInput {
    creatorWallet: string;
    name: string;
    symbol: string;
    description: string;
    websiteUrl?: string;
    twitterUrl?: string;
    telegramHandle?: string;
}

interface CreateTokenFormProps {
    onSubmit: (data: CreateTokenFormInput, logoFile: File) => Promise<void>;
    isSubmitting?: boolean;
}

function truncate(key: string) {
    return `${key.slice(0, 8)}...${key.slice(-8)}`;
}

const supabase = createClient();

export default function CreateTokenForm({ onSubmit, isSubmitting = false }: CreateTokenFormProps) {
    const [logoFile, setLogoFile] = useState<File | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [logoError, setLogoError] = useState('');
    const [wallets, setWallets] = useState<Wallet[]>([]);
    const [walletTypes, setWalletTypes] = useState<WalletType[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const { register, handleSubmit, control, formState: { errors } } = useForm<CreateTokenFormInput>();

    useEffect(() => {
        Promise.all([
            supabase.from('wallets').select('id, public_key, wallet_type_id'),
            supabase.from('wallet_type').select('id, name'),
        ]).then(([walletRes, typeRes]) => {
            if (walletRes.data) setWallets(walletRes.data);
            if (typeRes.data) setWalletTypes(typeRes.data);
        });
    }, []);

    const handleFormSubmit: SubmitHandler<CreateTokenFormInput> = async (data) => {
        if (!logoFile) {
            setLogoError('Logo image is required.');
            return;
        }
        setLogoError('');
        await onSubmit(data, logoFile);
    };

    const handleFileSelect = (file: File | null) => {
        if (file) {
            setLogoFile(file);
            setLogoError('');
        }
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(false);
        handleFileSelect(e.dataTransfer.files[0] ?? null);
    };

    return (
        <div className="grid grid-cols-3 gap-4">
            <form onSubmit={handleSubmit(handleFormSubmit)}>

                <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Token Info
                </p>

                <div className="mt-4">
                    <FieldLabel htmlFor="input-creator-wallet" className="mb-2">Creator Wallet</FieldLabel>
                    <Controller
                        name="creatorWallet"
                        control={control}
                        rules={{ required: "Creator wallet is required" }}
                        render={({ field }) => (
                            <Select onValueChange={field.onChange} value={field.value ?? ""}>
                                <SelectTrigger id="input-creator-wallet">
                                    <SelectValue placeholder="Select creator wallet" />
                                </SelectTrigger>
                                <SelectContent>
                                    {walletTypes.map((type, i) => {
                                        const group = wallets.filter((w) => w.wallet_type_id === type.id);
                                        if (!group.length) return null;
                                        return (
                                            <SelectGroup key={type.id}>
                                                {i > 0 && <SelectSeparator />}
                                                <SelectLabel>{type.name}</SelectLabel>
                                                {group.map((w) => (
                                                    <SelectItem key={w.id} value={String(w.id)}>
                                                        {truncate(w.public_key)}
                                                    </SelectItem>
                                                ))}
                                            </SelectGroup>
                                        );
                                    })}
                                </SelectContent>
                            </Select>
                        )}
                    />
                    {errors.creatorWallet && (
                        <p className="mt-1 text-sm text-destructive">{errors.creatorWallet.message}</p>
                    )}
                </div>

                <div className="mt-4">
                    <FieldLabel htmlFor="input-token-name">Token Name</FieldLabel>
                    <InputGroup className="mt-2 mb-1">
                        <InputGroupInput
                            {...register("name", { required: "Token name is required" })}
                            id="input-token-name"
                            name="name"
                            type="text"
                            placeholder="e.g. My Token"
                        />
                    </InputGroup>
                    {errors.name && (
                        <p className="mt-1 text-sm text-destructive">{errors.name.message}</p>
                    )}
                </div>

                <div className="mt-4">
                    <FieldLabel htmlFor="input-symbol">Symbol</FieldLabel>
                    <InputGroup className="mt-2 mb-1">
                        <InputGroupInput
                            {...register("symbol", { required: "Symbol is required" })}
                            id="input-symbol"
                            name="symbol"
                            type="text"
                            placeholder="e.g. MTK"
                        />
                    </InputGroup>
                    {errors.symbol && (
                        <p className="mt-1 text-sm text-destructive">{errors.symbol.message}</p>
                    )}
                </div>

                <div className="mt-4">
                    <FieldLabel>Choose Logo Image</FieldLabel>
                    <div
                        className={[
                            "mt-2 flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-6 text-sm transition-colors cursor-pointer",
                            isDragging
                                ? "border-primary bg-primary/5 text-primary"
                                : "border-border text-muted-foreground hover:border-primary/50 hover:bg-muted/30",
                        ].join(" ")}
                        onClick={() => fileInputRef.current?.click()}
                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={handleDrop}
                    >
                        <svg className="size-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                        </svg>
                        {logoFile ? (
                            <span className="font-medium text-foreground">{logoFile.name}</span>
                        ) : (
                            <span>Drag & drop or <span className="text-primary underline">browse</span></span>
                        )}
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
                        />
                    </div>
                    {logoError && (
                        <p className="mt-1 text-sm text-destructive">{logoError}</p>
                    )}
                    <FieldDescription className="italic">
                        PNG, JPG, GIF or SVG. Recommended 512×512.
                    </FieldDescription>
                </div>

                <div className="mt-4">
                    <FieldLabel htmlFor="input-description">Description</FieldLabel>
                    <textarea
                        {...register("description", { required: "Description is required" })}
                        id="input-description"
                        rows={4}
                        placeholder="Describe your token..."
                        className="mt-2 mb-1 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    {errors.description && (
                        <p className="mt-1 text-sm text-destructive">{errors.description.message}</p>
                    )}
                </div>

                <p className="mt-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Socials
                </p>

                <div className="mt-4">
                    <FieldLabel htmlFor="input-website">
                        Website URL{' '}
                        <span className="font-normal text-muted-foreground">(optional)</span>
                    </FieldLabel>
                    <InputGroup className="mt-2 mb-1">
                        <InputGroupInput
                            {...register("websiteUrl")}
                            id="input-website"
                            name="websiteUrl"
                            type="url"
                            placeholder="https://yourtoken.io"
                        />
                    </InputGroup>
                </div>

                <div className="mt-4">
                    <FieldLabel htmlFor="input-twitter">
                        Twitter URL{' '}
                        <span className="font-normal text-muted-foreground">(optional)</span>
                    </FieldLabel>
                    <InputGroup className="mt-2 mb-1">
                        <InputGroupInput
                            {...register("twitterUrl")}
                            id="input-twitter"
                            name="twitterUrl"
                            type="url"
                            placeholder="https://twitter.com/yourtoken"
                        />
                    </InputGroup>
                </div>

                <div className="mt-4">
                    <FieldLabel htmlFor="input-telegram">
                        Telegram Handle{' '}
                        <span className="font-normal text-muted-foreground">(optional)</span>
                    </FieldLabel>
                    <InputGroup className="mt-2 mb-1">
                        <InputGroupInput
                            {...register("telegramHandle")}
                            id="input-telegram"
                            name="telegramHandle"
                            type="text"
                            placeholder="@yourtoken"
                        />
                    </InputGroup>
                </div>

                <Button
                    className="mt-3"
                    size="lg"
                    variant="default"
                    type="submit"
                    disabled={isSubmitting}
                >
                    {isSubmitting ? (
                        <span className="flex items-center gap-2">
                            <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                            Creating...
                        </span>
                    ) : 'Create Token'}
                </Button>

            </form>
        </div>
    );
}
