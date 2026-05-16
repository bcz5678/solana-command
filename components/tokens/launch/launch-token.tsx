'use client'

import { useState } from 'react';
import { BuyerConfig } from './buyer-config-class';
import LaunchTokenPreview from './launch-token-preview';
import { TokenDTO } from '@/app/db/models/wallet';

type Props = {
    token: TokenDTO;
    launchBuyerConfig: BuyerConfig;
}

export default function LaunchToken({ token, launchBuyerConfig }: Props) {
    const [launchSubmitted, setLaunchSubmitted] = useState<boolean>(false);

    async function launchToken() {
        try {
            await fetch(`/api/pumpfun/launch-token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tokenId: token.id,
                    launchType: launchBuyerConfig.launchType,
                    launchBuyerConfig,
                }),
            });
            setLaunchSubmitted(true);
        } catch (error) {
            console.log(`components/tokens/launch/launch-token -> launchToken -> error: ${error}`);
        }
    }

    return (
        (launchSubmitted == false)
            ? <LaunchTokenPreview token={token} buyerConfig={launchBuyerConfig} />
            : <button onClick={launchToken}>Launch Token</button>
    );
}