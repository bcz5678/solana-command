import { solStringToLamports } from '@/lib/lamports';

import { handleError, initializeQuickNodeSolana, initializeConnection, parseAndValidateAddress } from '@/app/api/utils/helpers';

import { 
    Keypair, 
    PublicKey,  
    TransactionMessage,
    VersionedTransaction 
} from "@solana/web3.js";
import { PUMP_SDK, OnlinePumpSdk } from '@pump-fun/pump-sdk';
import { createClient } from '@/lib/supabase/client';

import { LaunchConfig } from '@/components/tokens/launch/launch-config-class';
import { LaunchType } from '@/components/tokens/launch/types';
import { WalletModelDTO } from '@/app/db/models/wallet';
import { TokenDTO } from '@/components/tokens/launch/types';

import bs58 from 'bs58';

export const dynamic = 'force-dynamic';

const supabase = createClient();

// initialize connection
const quicknodeSolana = initializeQuickNodeSolana();
const onlineSdk = new OnlinePumpSdk(quicknodeSolana.connection);

export async function POST(request: Request) {
    const body = await request.json();



    const launchConfigRaw = body.launchConfig ?? null;
    if (!launchConfigRaw) {
        return Response.json({ error: 'Missing launchConfig' }, { status: 400 });
    }

    const launchConfig = LaunchConfig.fromJSON(launchConfigRaw);
    const isValidLaunchType = Object.values(LaunchType).includes(launchConfig.launchType) && launchConfig.launchType !== LaunchType.unselected;

    if (launchConfig.token?.id != null && isValidLaunchType) {


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

        const creator = Keypair.fromSecretKey(bs58.decode(devWallet.private_key));
        const mint =  Keypair.fromSecretKey(bs58.decode(launchConfig.token.mint_secret_key!));


        if (launchConfig.walletTrades.length == 0) {
            const createIx = await PUMP_SDK.createV2Instruction({
                mint: mint.publicKey,
                name: launchConfig.token?.name!,
                symbol: launchConfig.token?.symbol!,
                uri: launchConfig.token?.token_meta_url!, // Your token metadata URI
                creator: creator.publicKey,
                user: creator.publicKey,
                mayhemMode: false,
                cashback: false,
            });


            const { blockhash } = await quicknodeSolana.connection.getLatestBlockhash("confirmed");

            const message = new TransactionMessage({
                payerKey: creator.publicKey,
                recentBlockhash: blockhash,
                instructions: [createIx],
            }).compileToV0Message();

            const tx = new VersionedTransaction(message);
            tx.sign([creator, mint]); // Both creator AND mint must sign

            const signature = await quicknodeSolana.connection.sendTransaction(tx);
            console.log("Token created! Tx:", signature);

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
