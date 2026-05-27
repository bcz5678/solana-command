import { solStringToLamports } from '@/lib/lamports';

import { handleError, initializeQuickNodeSolana, initializeConnection, parseAndValidateAddress } from '@/app/api/utils/helpers';

import {
    Keypair,
    TransactionMessage,
    TransactionSignature,
    VersionedTransaction
} from "@solana/web3.js";
import { PUMP_SDK, OnlinePumpSdk } from '@pump-fun/pump-sdk';
import { createClient } from '@/lib/supabase/client';

import { LaunchConfig } from '@/components/tokens/launch/launch-config-class';
import { LaunchType } from '@/components/tokens/launch/types';
import { WalletModelDTO } from '@/app/db/models/wallet';
import { TokenDTO } from '@/components/tokens/launch/types';

import { requireSuperAdmin } from '@/lib/auth/require-super-admin';
import { SupabaseClient } from '@supabase/supabase-js';


export const dynamic = 'force-dynamic';



// initialize connection
const quicknodeSolana = initializeQuickNodeSolana();
const onlineSdk = new OnlinePumpSdk(quicknodeSolana.connection);

export async function POST(request: Request) {
    let admin, userId
        try {
            ({ admin, userId } = await requireSuperAdmin())
        } catch (e) {
            return e as Response   // the 401 or 403
        }



    const body = await request.json();

    const launchConfigRaw = body.launchConfig ?? null;
    if (!launchConfigRaw) {
        return Response.json({ error: 'Missing launchConfig' }, { status: 400 });
    }

    const launchConfig = LaunchConfig.fromJSON(launchConfigRaw);
    const isValidLaunchType = Object.values(LaunchType).includes(launchConfig.launchType) && launchConfig.launchType !== LaunchType.unselected;

    if (launchConfig.token?.id != null && isValidLaunchType) {


        const { data: token, error: tokenError } = await admin
            .from('tokens')
            .select('*')
            .eq('id', launchConfig.token?.id)
            .single<TokenDTO>();

        if (tokenError || !token) {
            console.log(tokenError);
            return Response.json({ error: 'Token not found' }, { status: 404 });
        }

        const { data: devWallet, error: walletError } = await admin
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
                return processLaunchBlock0(admin, launchConfig);
                break;
            case LaunchType.swarm:
                return processLaunchSwarm(admin, launchConfig);
                break;
            case LaunchType.staggered:
                return processLaunchStaggered(admin, launchConfig);
                break;
            default:
                console.log('Default launchType');
                break;
        }
    }
}


async function processLaunchBlock0(admin: SupabaseClient, launchConfig: LaunchConfig) : Promise<Response>{
    console.log('Block0 launchType');

    console.log(`launchConfig: ${launchConfig.token?.dev_wallet_id}`);

    const { data: devWallet, error } = await admin
        .from('wallets')
        .select('*')
        .eq('id', launchConfig.token?.dev_wallet_id)
        .single<WalletModelDTO>();

        console.log(`DevWallet:${devWallet?.public_key}`);

    if (devWallet != null && launchConfig.token != null) {

        const creator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(devWallet.secret_key)));
        const mint = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(launchConfig.token.mint_secret_key!)));



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

            console.log(`api/pumpfun/launch-token/route.ts ->  createIx: ${createIx.data}`);

            
            const { blockhash } = await quicknodeSolana.connection.getLatestBlockhash("confirmed");


            console.log(`api/pumpfun/launch-token/route.ts ->  blockhash: ${blockhash}`);

            const message = new TransactionMessage({
                payerKey: creator.publicKey,
                recentBlockhash: blockhash,
                instructions: [createIx],
            }).compileToV0Message();

            console.log(`api/pumpfun/launch-token/route.ts ->  message: ${message}`);

            const tx = new VersionedTransaction(message);
            tx.sign([creator, mint]); // Both creator AND mint must sign

             console.log(`api/pumpfun/launch-token/route.ts ->  tx: ${tx}`);

            /*
            const signature = await quicknodeSolana.connection.sendTransaction(tx);
            console.log("Token created! Tx:", signature);
            */

            return new Response(JSON.stringify({message: "Token Successfully created"}), {
                headers: { 'Content-Type': 'application/json' },
                status: 200,
            });
        } else {
            return new Response(JSON.stringify({message: "None Zero not implemented yet"}), {
                headers: { 'Content-Type': 'application/json' },
                status: 200,
            });
        }
    } else {
            return new Response(JSON.stringify({message: "Token Failed"}), {
                headers: { 'Content-Type': 'application/json' },
                status: 200,
            });
    }
}


function processLaunchSwarm(
    admin: SupabaseClient, 
    launchConfig: LaunchConfig
) {
    console.log('Swarm launchType');
}



function processLaunchStaggered(
    admin: SupabaseClient, 
    launchConfig: LaunchConfig
) {
    console.log('Staggered launchType');
}
