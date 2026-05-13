"use client"
import React, { FormEventHandler, useState } from 'react';
import { useRouter } from 'next/navigation'; 
import { InputGroup,  InputGroupAddon, InputGroupInput, } from "@/components/ui/input-group";
import {   SearchIcon } from 'lucide-react';
import { PublicKey } from '@solana/web3.js';

export default function WalletSearch({onSearchSubmit}) {
    const router = useRouter();
    const [error, setError] = useState<string | null>(null);

    const handleSearch: FormEventHandler<HTMLFormElement> = async (event) => {
        event.preventDefault();
        setError(null);

        const searchValue = (event.currentTarget.elements.namedItem('wallet-search') as HTMLInputElement).value;

        try {
            const walletAddress = await validateAddress(searchValue);
            onSearchSubmit(walletAddress);
        } catch (error) {
            setError(error instanceof Error ? error.message : 'An unexpected error occurred');
        }
    };

    return (
        <>
            <form onSubmit={handleSearch}>
                <InputGroup>
                    <InputGroupInput
                        name="wallet-search"
                        className="w-100 sm:w-75 lg:w-100"
                        placeholder="Wallet search..."
                        type="search"
                    />
                    <InputGroupAddon>
                        <SearchIcon />
                    </InputGroupAddon>
                </InputGroup>
            </form>
            {error && <p className="text-red-500">{error}</p>} {/* Display error message if any */}
        </>
    );
};


async function validateAddress(walletAddress: string): Promise<string> {
    if (!walletAddress) {
        throw new Error('Wallet address is required.');
    }
    try {
        const pubKey = new PublicKey(walletAddress);
        return pubKey.toBase58();
    } catch {
        throw new Error('Invalid wallet address.');
    }
}