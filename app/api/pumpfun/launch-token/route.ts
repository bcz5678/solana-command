import { solStringToLamports } from '@/lib/lamports';

import { handleError, initializeQuickNodeSolana, initializeConnection, parseAndValidateAddress } from '@/app/api/utils/helpers';

import { Keypair, PublicKey } from "@solana/web3.js";
import { PUMP_SDK, OnlinePumpSdk } from '@nirholas/pump-sdk';
import { createClient } from '@/lib/supabase/client';

import { BuyerConfig } from '@/components/tokens/launch/buyer-config-class';
import { LaunchType } from '@/components/tokens/launch/types';
import { TokenDTO, WalletModelDTO } from '@/app/db/models/wallet';

import bs58 from 'bs58';

export const dynamic = 'force-dynamic';

const supabase = createClient();

export async function POST(request: Request) {
    const body = await request.json();
    const tokenId: number | null = body.tokenId != null ? Number(body.tokenId) : null;
    const launchTypeRequest: string | null = body.launchType ?? null;

    const isLaunchType = Object.values(LaunchType).includes(launchTypeRequest as LaunchType);
    const launchType: LaunchType | null = isLaunchType ? (launchTypeRequest as LaunchType) : null;

    const buyerConfigRaw = body.buyerConfig ?? null;

    if (tokenId != null &&
        launchType != null &&
        buyerConfigRaw != null
    ) {

        const buyerConfig = BuyerConfig.fromJSON(
            typeof buyerConfigRaw === 'string' ? JSON.parse(buyerConfigRaw) : buyerConfigRaw
        );

        // initialize connection
        const quicknodeSolana = initializeQuickNodeSolana();
        const onlineSdk = new OnlinePumpSdk(quicknodeSolana.connection);

        const { data: token, error: tokenError } = await supabase
            .from('tokens')
            .select('*')
            .eq('id', tokenId)
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

        switch(launchType) {
            case LaunchType.block0:
                processLaunchBlock0(token, buyerConfig);
                break;
            case LaunchType.swarm:
                processLaunchSwarm(token, buyerConfig);
                break;
            case LaunchType.staggered:
                processLaunchStaggered(token, buyerConfig);
                break;
            case LaunchType.unselected:
                console.log('Unselected launchType');
                break;
            default: 
                console.log('Default launchType');
                break;             
        }
    }
}


async function processLaunchBlock0(
    token: TokenDTO, 
    buyerConfig: BuyerConfig
) {
    console.log('Block0 launchType');

    const { data: devWallet, error } = await supabase
        .from('wallets')
        .select('private_key')
        .eq('id', token.dev_wallet_id)
        .single<WalletModelDTO>();

    if (devWallet != null) {
        if(buyerConfig.walletTrades.length == 0) {
            const createIx = await PUMP_SDK.createV2Instruction({
                mint: Keypair.fromSecretKey(bs58.decode(devWallet.private_key)).publicKey,
                name: token.name,
                symbol: token.symbol,
                uri: "https://example.com/metadata.json", // Your token metadata URI
                creator: Keypair.fromSecretKey(bs58.decode(devWallet.private_key)).publicKey,
                user: Keypair.fromSecretKey(bs58.decode(devWallet.private_key)).publicKey,
                mayhemMode: false,
                cashback: false,
            });
        } else {



        }
    }
}


function processLaunchSwarm(
    token: TokenDTO, 
    buyerConfig: BuyerConfig
) {
    console.log('Swarm launchType');
}



function processLaunchStaggered(
    token: TokenDTO, 
    buyerConfig: BuyerConfig
) {
    console.log('Staggered launchType');
}