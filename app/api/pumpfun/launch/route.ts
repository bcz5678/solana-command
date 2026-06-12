// app/api/pumpfun/launch-token/route.ts

import {
    initializeQuickNodeSolana
} from '@/app/api/utils/helpers';

import {
    Keypair,
    TransactionMessage,
    VersionedTransaction
} from '@solana/web3.js';
import { PUMP_SDK, OnlinePumpSdk, newBondingCurve, getBuyTokenAmountFromSolAmount } from '@nirholas/pump-sdk';
import { SupabaseClient }        from '@supabase/supabase-js';

import { LaunchConfig }          from '@/components/tokens/launch/launch-config-class';
import { LaunchType }            from '@/components/tokens/launch/types';
import { requireSuperAdmin }     from '@/lib/auth/require-super-admin';

export const dynamic = 'force-dynamic';

// ── Connection (module-scoped, reused across requests) ─────────
const quicknodeSolana = initializeQuickNodeSolana();
const onlineSdk       = new OnlinePumpSdk(quicknodeSolana.connection);

// ── Launch data shape returned by get_token_launch_data() ──────
interface TokenLaunchData {
    mint_id:                  string
    mint_public_key:          string
    mint_vault_secret_name:   string
    token_name:               string
    token_symbol:             string
    metadata_uri:             string
    decimals:                 number
    launch_status:            string
    vanity_keypair_id:        string | null
    dev_wallet_id:            string | null
    dev_wallet_public_key:    string | null
    dev_wallet_vault_secret:  string | null
}

export async function POST(request: Request) {

    // ── 1. Auth — super admin only ─────────────────────────────
    let admin: SupabaseClient
    try {
        ({ admin } = await requireSuperAdmin());
    } catch (e) {
        return e as Response;   // 401 or 403
    }

    // ── 2. Parse body ──────────────────────────────────────────
    const body = await request.json();

    const launchConfigRaw = body.launchConfig ?? null;
    if (!launchConfigRaw) {
        return Response.json({ error: 'Missing launchConfig' }, { status: 400 });
    }

    const launchConfig    = LaunchConfig.fromJSON(launchConfigRaw);
    const isValidLaunchType =
        Object.values(LaunchType).includes(launchConfig.launchType) &&
        launchConfig.launchType !== LaunchType.unselected;

    if (launchConfig.token?.id == null || !isValidLaunchType) {
        return Response.json(
            { error: 'Invalid launch config — missing token id or launch type' },
            { status: 400 }
        );
    }

    // ── 3. Route to the correct launch processor ───────────────
    switch (launchConfig.launchType) {
        case LaunchType.block0:
            return processLaunchBlock0(admin, launchConfig);
        case LaunchType.swarm:
            return processLaunchSwarm(admin, launchConfig);
        case LaunchType.staggered:
            return processLaunchStaggered(admin, launchConfig);
        default:
            return Response.json({ error: 'Unknown launch type' }, { status: 400 });
    }
}


// ============================================================
// BLOCK 0 LAUNCH
// Single transaction: create mint + (optional) initial buys
// ============================================================
async function processLaunchBlock0(
    admin:        SupabaseClient,
    launchConfig: LaunchConfig
): Promise<Response> {

    const mintId = launchConfig.token?.id;
    if (!mintId) {
        return Response.json({ error: 'Missing token id' }, { status: 400 });
    }

    // ── A. Fetch launch data (DB fields + vault pointers) ──────
    // get_token_launch_data() returns both the mint authority
    // vault name and the dev wallet vault name in one call.
    const { data: launchData, error: dataError } = await admin
        .rpc('get_token_launch_data', { p_mint_id: mintId })
        .returns<TokenLaunchData>()
        .single();

    if (dataError || !launchData) {
        console.error('[launch] get_token_launch_data error:', dataError?.message);
        return Response.json({ error: 'Token launch data not found' }, { status: 404 });
    }

    // ── B. Guard: must be a draft, must have a dev wallet ──────
    if (launchData.launch_status !== 'draft') {
        return Response.json(
            {
                error:        'Token cannot be launched',
                launchStatus: launchData.launch_status,
                hint:         'Only draft tokens can be launched'
            },
            { status: 409 }
        );
    }

    if (!launchData.dev_wallet_id || !launchData.dev_wallet_vault_secret) {
        return Response.json(
            { error: 'Token has no dev wallet assigned' },
            { status: 400 }
        );
    }

    if (!launchData.mint_vault_secret_name) {
        return Response.json(
            { error: 'Token has no mint vault secret — vanity keypair may not be fully provisioned' },
            { status: 400 }
        );
    }

    // ── C. Lock the draft — transition to 'launching' ──────────
    // Prevents a concurrent request from double-launching.
    const { error: lockError } = await admin
        .rpc('mark_token_launching', { p_mint_id: mintId });

    if (lockError) {
        console.error('[launch] mark_token_launching error:', lockError.message);
        return Response.json(
            { error: 'Token is already launching or not in draft state' },
            { status: 409 }
        );
    }

    // ── D. Fetch both secret keys from Vault ───────────────────
    // get_vault_secret() is service_role only — admin client used.
    let creator: Keypair | null = null;
    let mint:    Keypair | null = null;

    try {
        // Dev wallet (creator / payer)
        const { data: creatorSecret, error: creatorErr } = await admin
            .rpc('get_vault_secret', {
                secret_name: launchData.dev_wallet_vault_secret
            });

        if (creatorErr || !creatorSecret) {
            throw new Error(`creator key fetch failed: ${creatorErr?.message}`);
        }

        // Mint authority (the vanity keypair)
        const { data: mintSecret, error: mintErr } = await admin
            .rpc('get_vault_secret', {
                secret_name: launchData.mint_vault_secret_name
            });

        if (mintErr || !mintSecret) {
            throw new Error(`mint key fetch failed: ${mintErr?.message}`);
        }

        // Reconstruct keypairs in memory
        creator = Keypair.fromSecretKey(
            Uint8Array.from(JSON.parse(creatorSecret as string))
        );
        mint = Keypair.fromSecretKey(
            Uint8Array.from(JSON.parse(mintSecret as string))
        );

        // Sanity check — derived pubkeys must match DB records
        if (creator.publicKey.toBase58() !== launchData.dev_wallet_public_key) {
            throw new Error('creator public key mismatch — vault/DB inconsistency');
        }
        if (mint.publicKey.toBase58() !== launchData.mint_public_key) {
            throw new Error('mint public key mismatch — vault/DB inconsistency');
        }

    } catch (err) {
        // Failed to load keys — revert draft, wipe anything loaded
        creator?.secretKey.fill(0);
        mint?.secretKey.fill(0);

        await admin.rpc('fail_token_launch', {
            p_mint_id: mintId,
            p_reason:  `key load failed: ${(err as Error).message}`
        });

        const reason = (err as Error).message;
        console.error('[launch] key load error:', reason);
        return Response.json(
            { error: `Failed to load signing keys: ${reason}` },
            { status: 500 }
        );
    }

    // ── E. Build, sign, and send the launch transaction ────────
    let signature: string;

    try {
        // ── Determine instruction set based on buyer count ────────
        const devWalletId  = launchData.dev_wallet_id;
        const tradeCount   = launchConfig.walletTrades.length;
        const soloDevBuy   = tradeCount === 1
            && launchConfig.walletTrades[0].walletId === devWalletId;

        let instructions: import('@solana/web3.js').TransactionInstruction[];

        if (tradeCount === 0) {
            // No initial buy — create only
            instructions = [await PUMP_SDK.createV2Instruction({
                mint:       mint.publicKey,
                name:       launchData.token_name,
                symbol:     launchData.token_symbol,
                uri:        launchData.metadata_uri,
                creator:    creator.publicKey,
                user:       creator.publicKey,
                mayhemMode: false,
                cashback:   false,
            })];

        } else if (soloDevBuy) {
            // Dev wallet is the sole buyer — create + buy in one transaction
            const solAmount    = launchConfig.walletTrades[0].buyAmountInSOL;
            const global       = await onlineSdk.fetchGlobal();
            const bondingCurve = newBondingCurve(global);
            const tokenAmount  = getBuyTokenAmountFromSolAmount({
                global,
                feeConfig:   null,
                mintSupply:  null,
                bondingCurve,
                amount:      solAmount,
            });

            instructions = await PUMP_SDK.createV2AndBuyInstructions({
                global,
                mint:       mint.publicKey,
                name:       launchData.token_name,
                symbol:     launchData.token_symbol,
                uri:        launchData.metadata_uri,
                creator:    creator.publicKey,
                user:       creator.publicKey,
                amount:     tokenAmount,
                solAmount,
                mayhemMode: false,
                cashback:   false,
            });

        } else {
            // Multiple buyers — not yet implemented
            creator.secretKey.fill(0);
            mint.secretKey.fill(0);

            await admin.rpc('fail_token_launch', {
                p_mint_id: mintId,
                p_reason:  'multi-wallet block0 buy not yet implemented',
            });

            return Response.json(
                { message: 'Multi-wallet block0 launch not implemented yet' },
                { status: 501 }
            );
        }

        const { blockhash } = await quicknodeSolana.connection
            .getLatestBlockhash('confirmed');

        const message = new TransactionMessage({
            payerKey:        creator.publicKey,
            recentBlockhash: blockhash,
            instructions,
        }).compileToV0Message();

        const tx = new VersionedTransaction(message);

        // Both creator AND mint must sign
        tx.sign([creator, mint]);

        // Send and confirm
        signature = await quicknodeSolana.connection.sendTransaction(tx, {
            skipPreflight:       false,
            preflightCommitment: 'confirmed',
            maxRetries:          3
        });

        const latestBlockhash = await quicknodeSolana.connection
            .getLatestBlockhash('confirmed');

        await quicknodeSolana.connection.confirmTransaction(
            {
                signature,
                blockhash:            latestBlockhash.blockhash,
                lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
            },
            'confirmed'
        );

    } catch (err) {
        // Tx failed — wipe keys, revert draft for retry
        creator.secretKey.fill(0);
        mint.secretKey.fill(0);

        await admin.rpc('fail_token_launch', {
            p_mint_id: mintId,
            p_reason:  `tx failed: ${(err as Error).message}`
        });

        console.error('[launch] tx error:', (err as Error).message);
        return Response.json(
            { error: `Launch transaction failed: ${(err as Error).message}` },
            { status: 500 }
        );

    } finally {
        // ── Always wipe keys — success or failure ─────────────
        creator?.secretKey.fill(0);
        mint?.secretKey.fill(0);
    }

    // ── F. Mark launched + retire vanity keypair ───────────────
    const { error: completeError } = await admin
        .rpc('complete_token_launch', {
            p_mint_id:      mintId,
            p_tx_signature: signature
        });

    if (completeError) {
        // Token IS launched on-chain but DB update failed — log critical
        console.error(
            '[launch] CRITICAL: token launched on-chain but DB update failed',
            { mintId, signature, error: completeError.message }
        );
        return Response.json(
            {
                message:     'Token launched but DB sync failed — manual review needed',
                signature,
                mintAddress: launchData.mint_public_key,
                partial:     true
            },
            { status: 200 }
        );
    }

    // ── G. Success ─────────────────────────────────────────────
    return Response.json(
        {
            message:     'Token successfully launched',
            mintId,
            mintAddress: launchData.mint_public_key,
            tokenName:   launchData.token_name,
            tokenSymbol: launchData.token_symbol,
            signature,
            explorerUrl: `https://solscan.io/tx/${signature}`,
            pumpUrl:     `https://pump.fun/${launchData.mint_public_key}`
        },
        { status: 200 }
    );
}


// ============================================================
// SWARM LAUNCH — not yet implemented
// ============================================================
async function processLaunchSwarm(
    _admin:        SupabaseClient,
    _launchConfig: LaunchConfig
): Promise<Response> {
    return Response.json(
        { message: 'Swarm launch not implemented yet' },
        { status: 501 }
    );
}


// ============================================================
// STAGGERED LAUNCH — not yet implemented
// ============================================================
async function processLaunchStaggered(
    _admin:        SupabaseClient,
    _launchConfig: LaunchConfig
): Promise<Response> {
    return Response.json(
        { message: 'Staggered launch not implemented yet' },
        { status: 501 }
    );
}
