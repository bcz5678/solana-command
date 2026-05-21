'use client'

import { useState } from 'react';
import { LaunchConfig } from './launch-config-class';
import LaunchTokenPreview from './launch-token-preview';
import LaunchTokenFinal from './launch-token-final';

type Props = {
    launchConfig: LaunchConfig;
}

export default function LaunchToken({ launchConfig }: Props) {
    const [launchSubmitted, setLaunchSubmitted] = useState<boolean>(false);

    async function handleLaunch() {
        try {
            const response = await fetch(`/api/pumpfun/launch-token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ launchConfig }),
            });
           
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            const data = await response.json();
            console.log(data);

        } catch (error) {
            console.log(`components/tokens/launch/launch-token -> handleLaunch -> error: ${error}`);
        }
        setLaunchSubmitted(true);
    }

    if (launchSubmitted) {
        <LaunchTokenFinal />
    }

    return <LaunchTokenPreview launchConfig={launchConfig} onLaunch={handleLaunch} />;
}