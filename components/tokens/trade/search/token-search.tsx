"use client"

import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { BadgeCentIcon } from 'lucide-react';

import { useRouter } from 'next/navigation'; 
import { FormEventHandler, useState } from 'react';

export default function TokenSearch({ onSearchSubmit }) {
    const router = useRouter();
    const [error, setError] = useState<string | null>(null);

    const handleSearch: FormEventHandler<HTMLFormElement> = async (event) => {
        event.preventDefault();
        setError(null);

        const searchValue = (event.currentTarget.elements.namedItem('token-pair') as HTMLInputElement).value;
        
        try {
            onSearchSubmit(searchValue);
        } catch (error) {
            setError(error instanceof Error ? error.message : 'An unexpected error occurred');
        }
    };

    return (
        <>
            <form onSubmit={ handleSearch }>
                <InputGroup>
                    <InputGroupInput 
                        placeholder="Token Pair" 
                        name="token-pair"
                        className="w-100 sm:w-75 lg:w-100"
                        type="search"
                    />
                    <InputGroupAddon>
                        <BadgeCentIcon />
                    </InputGroupAddon>
                </InputGroup>
            </form>
        </>
    );
}
