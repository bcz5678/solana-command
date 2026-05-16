'use client'

import { useState } from 'react';
import { LaunchConfig } from './launch-config-class';
import LaunchTokenPreview from './launch-token-preview';

type Props = {
    launchConfig: LaunchConfig;
}

export default function LaunchToken({ launchConfig }: Props) {
    const [launchSubmitted, setLaunchSubmitted] = useState<boolean>(false);

    async function launchToken() {
        try {
            await fetch(`/api/pumpfun/launch-token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    launchConfig,
                }),
            });
            setLaunchSubmitted(true);
        } catch (error) {
            console.log(`components/tokens/launch/launch-token -> launchToken -> error: ${error}`);
        }
    }

    return (
        (launchSubmitted == false)
            ? <LaunchTokenPreview launchConfig={launchConfig} />
            : <button onClick={launchToken}>Launch Token</button>
    );
}