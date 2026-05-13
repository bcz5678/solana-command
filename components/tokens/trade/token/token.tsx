import { useState, useEffect } from 'react';
import {
    Token,
    TokenAmount,
    TokenInfo,
    TokensResponse,
} from '@/components/tokens/trade/token/types';

export interface TokenProps {
    walletAddress: string;
}

export default function TokenData({walletAddress}: TokenProps) {
    const [tokens, setTokens] = useState<Token[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchTokens = async () => {
            setLoading(true);
            
            try {
                const response = await fetch(`/api/wallet/tokens?walletAddress=${walletAddress}`);
                if (!response.ok) throw new Error('Failed to fetch tokens');
                const data: TokensResponse = await response.json();
                setTokens(data.tokens);
            } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
            } finally {
                setLoading(false);
            }
        };

        if (walletAddress) fetchTokens();
    }, [walletAddress]);
}