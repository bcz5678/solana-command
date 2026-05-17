import { solStringToLamports } from '@/lib/lamports';

import { handleError, initializeQuickNodeSolana, initializeConnection, parseAndValidateAddress } from '@/app/api/utils/helpers';

import { Keypair, PublicKey } from "@solana/web3.js";
import { PUMP_SDK, OnlinePumpSdk } from '@pump-fun/pump-sdk';
import { createClient } from '@/lib/supabase/client';

import { LaunchConfig } from '@/components/tokens/launch/launch-config-class';
import { LaunchType } from '@/components/tokens/launch/types';
import { WalletModelDTO } from '@/app/db/models/wallet';
import { TokenDTO } from '@/components/tokens/launch/types';

import bs58 from 'bs58';

export const dynamic = 'force-dynamic';

const supabase = createClient();

export async function POST(request: Request) {
    const body = await request.json();

    const launchConfigRaw = body.launchConfig ?? null;
    if (!launchConfigRaw) {
        return Response.json({ error: 'Missing launchConfig' }, { status: 400 });
    }

    const launchConfig = LaunchConfig.fromJSON(launchConfigRaw);
    const isValidLaunchType = Object.values(LaunchType).includes(launchConfig.launchType) && launchConfig.launchType !== LaunchType.unselected;

    if (launchConfig.token?.id != null && isValidLaunchType) {
        // initialize connection
        const quicknodeSolana = initializeQuickNodeSolana();
        const onlineSdk = new OnlinePumpSdk(quicknodeSolana.connection);

        const { data: token, error: tokenError } = await supabase
            .from('tokens')
            .select('*')
            .eq('id', launchConfig.token?.id)
            .single<TokenDTO>();

        if (tokenError || !token) {
            console.log(tokenError);
            return Response.json({ error: 'Token not found' }, { status: 404 });
        }

        const { data: devWallet, error: walletError } = await supabase
            .from('wallets')
            .select('*')
            .eq('id', token.dev_wallet_id)
            .single<WalletModelDTO>();

        if (walletError || !devWallet) {
            console.log(walletError);
            return Response.json({ error: 'Dev wallet not found' }, { status: 404 });
        }

        switch (launchConfig.launchType) {
            case LaunchType.block0:
                processLaunchBlock0(launchConfig);
                break;
            case LaunchType.swarm:
                processLaunchSwarm(launchConfig);
                break;
            case LaunchType.staggered:
                processLaunchStaggered(launchConfig);
                break;
            default:
                console.log('Default launchType');
                break;
        }
    }
}


async function processLaunchBlock0(
    launchConfig: LaunchConfig
) {
    console.log('Block0 launchType');

    const { data: devWallet, error } = await supabase
        .from('wallets')
        .select('private_key')
        .eq('id', launchConfig.token?.dev_wallet_id)
        .single<WalletModelDTO>();

    if (devWallet != null && launchConfig.token != null) {
        if (launchConfig.walletTrades.length == 0) {
            const createIx = await PUMP_SDK.createV2Instruction({
                mint: Keypair.fromSecretKey(bs58.decode(devWallet.private_key)).publicKey,
                name: launchConfig.token?.name!,
                symbol: launchConfig.token?.symbol!,
                uri: "https://example.com/metadata.json", // Your token metadata URI
                creator: Keypair.fromSecretKey(bs58.decode(devWallet.private_key)).publicKey,
                user: Keypair.fromSecretKey(bs58.decode(devWallet.private_key)).publicKey,
                mayhemMode: false,
                cashback: false,
            });

            console.log('');

        } else {
            console.log('');
        }
    }
}


function processLaunchSwarm(
    launchConfig: LaunchConfig
) {
    console.log('Swarm launchType');
}



function processLaunchStaggered(
    launchConfig: LaunchConfig
) {
    console.log('Staggered launchType');
}
