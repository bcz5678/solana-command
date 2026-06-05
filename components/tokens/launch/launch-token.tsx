'use client'

import { useState } from 'react';
import { LaunchConfig } from './launch-config-class';
import LaunchTokenPreview from './launch-token-preview';
import LaunchTokenFinal from './launch-token-final';

export interface LaunchResult {
    message:      string
    mintId?:      string
    mintAddress?: string
    tokenName?:   string
    tokenSymbol?: string
    signature?:   string
    explorerUrl?: string
    pumpUrl?:     string
    partial?:     boolean
    error?:       string
}

type Props = {
    launchConfig: LaunchConfig;
}

export default function LaunchToken({ launchConfig }: Props) {
    const [launchResult, setLaunchResult] = useState<LaunchResult | null>(null);

    async function handleLaunch() {
        try {
            const response = await fetch(`/api/pumpfun/launch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ launchConfig }),
            });

            const data: LaunchResult = await response.json();
            setLaunchResult(data);
        } catch (error) {
            console.log(`components/tokens/launch/launch-token -> handleLaunch -> error: ${error}`);
            setLaunchResult({ message: 'Launch failed', error: (error as Error).message });
        }
    }

    if (launchResult) {
        return <LaunchTokenFinal result={launchResult} />;
    }

    return <LaunchTokenPreview launchConfig={launchConfig} onLaunch={handleLaunch} />;
}