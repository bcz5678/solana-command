// app/api/pumpfun/launch-token/route.ts

import {
    initializeQuickNodeSolana
} from '@/app/api/utils/helpers';

import {
    Keypair,
    PublicKey,
    SystemProgram,
    TransactionInstruction,
    TransactionMessage,
    VersionedTransaction
} from '@solana/web3.js';
import BN from 'bn.js';
import bs58 from 'bs58';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import {
    PUMP_SDK,
    OnlinePumpSdk,
    newBondingCurve,
    getBuyTokenAmountFromSolAmount,
    BONDING_CURVE_NEW_SIZE,
    type BondingCurve,
} from '@nirholas/pump-sdk';
import { SupabaseClient }        from '@supabase/supabase-js';

import { LaunchConfig }          from '@/components/tokens/launch/launch-config-class';
import { LaunchType }            from '@/components/tokens/launch/types';
import { requireSuperAdmin }     from '@/lib/auth/require-super-admin';
import { logTrade }              from '@/lib/trades/log';
import { lamportsBNToSolNumber } from '@/lib/lamports';
import { getWalletKeypairById }  from '@/lib/vault/get-wallet-by-id';
import { QuicknodeJitoExecutor } from '@/lib/jito/clients/quicknode-jito-executor';

// Jito bundles cap at 5 transactions — tx #1 is create+dev-buy, leaving room
// for at most 4 additional wallets buying atomically alongside the launch.
const MAX_BUNDLE_WALLETS = 5;

/** Advances a simulated bonding curve by one buy, using the same constant-product
 *  invariant (k = virtualSol × virtualToken) the on-chain program applies — mirrors
 *  the sequential-curve-simulation pattern in app/api/trade/bundle/buy/route.ts. */
function advanceBuyCurve(curve: BondingCurve, tokenAmount: BN): BondingCurve {
    const virtualSolCost = curve.virtualSolReserves
        .mul(tokenAmount)
        .div(curve.virtualTokenReserves.sub(tokenAmount));

    return {
        ...curve,
        virtualSolReserves:   curve.virtualSolReserves.add(virtualSolCost),
        virtualTokenReserves: curve.virtualTokenReserves.sub(tokenAmount),
        realTokenReserves:    curve.realTokenReserves.sub(tokenAmount),
        tokenTotalSupply:     curve.tokenTotalSupply.sub(tokenAmount),
    };
}

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

    // Signs a real transaction with real keys but simulates instead of
    // broadcasting, and never mutates the draft's launch_status.
    const dryRun: boolean = body.dryRun === true;

    // Only used when launchConfig.walletTrades has more than one wallet (a
    // "Dev + Bundle" launch) — ignored for the single-wallet/create-only paths.
    const jitoTipInLamports: string = typeof body.jitoTipInLamports === 'string' ? body.jitoTipInLamports : '10000';
    const bundleSlippage:    number = typeof body.slippage === 'number' ? body.slippage : 0.05;

    // ── 3. Route to the correct launch processor ───────────────
    switch (launchConfig.launchType) {
        case LaunchType.block0:
            return processLaunchBlock0(admin, launchConfig, dryRun, jitoTipInLamports, bundleSlippage);
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
    admin:            SupabaseClient,
    launchConfig:     LaunchConfig,
    dryRun:           boolean,
    jitoTipInLamports: string = '10000',
    bundleSlippage:    number = 0.05,
): Promise<Response> {

    const mintId = launchConfig.token?.id;
    if (!mintId) {
        return Response.json({ error: 'Missing token id' }, { status: 400 });
    }

    const walletTradeCount = launchConfig.walletTrades.length;
    console.log(`[launch:block0] start mintId=${mintId} dryRun=${dryRun} tradeCount=${walletTradeCount} jitoTipInLamports=${jitoTipInLamports} bundleSlippage=${bundleSlippage}`);

    // ── A. Fetch launch data (DB fields + vault pointers) ──────
    // get_token_launch_data() returns both the mint authority
    // vault name and the dev wallet vault name in one call.
    const { data: launchData, error: dataError } = await admin
        .rpc('get_token_launch_data', { p_mint_id: mintId })
        .returns<TokenLaunchData>()
        .single();

    if (dataError || !launchData) {
        console.error(`[launch:block0] get_token_launch_data error mintId=${mintId}:`, dataError?.message);
        return Response.json({ error: 'Token launch data not found' }, { status: 404 });
    }

    // launchData resolves to `never` under this repo's Supabase client typing (pre-existing —
    // affects every launchData.* access in this file, not introduced here). Cast once so the
    // new logTrade() call sites below don't add to that count.
    const launchInfo = launchData as TokenLaunchData;

    console.log(`[launch:block0] loaded mintId=${mintId} launch_status=${launchInfo.launch_status} dev_wallet_id=${launchInfo.dev_wallet_id ?? 'null'} mint_public_key=${launchInfo.mint_public_key}`);

    // ── B. Guard: must be a draft, must have a dev wallet ──────
    if (launchData.launch_status !== 'draft') {
        // This is the single most common source of a confusing "Token cannot be
        // launched" report — it fires for ANY non-draft status, not just "already
        // launched" or "actually broken." A token stuck at 'launching' (e.g. a prior
        // attempt whose request was killed — timeout, server restart — before its own
        // catch block could call fail_token_launch to revert it to 'draft') looks
        // identical to the client unless launchStatus/hint below actually get
        // surfaced in the UI. Logging the real status here is the fastest way to
        // tell "stuck from an interrupted attempt" apart from "genuinely already launched."
        console.warn(`[launch:block0] BLOCKED mintId=${mintId} launch_status=${launchInfo.launch_status} (requested tradeCount=${walletTradeCount}, dryRun=${dryRun}) — only 'draft' tokens can launch`);
        // In Test Mode, an already-launched token is a valid choice — it's how
        // downstream Trade nodes get a real bonding curve to read against
        // (see the Launch Builder's Token picker). There's nothing to actually
        // simulate here (the mint already exists), so treat it as a confirmed
        // pass-through instead of blocking the whole chain. Any other non-draft
        // status (e.g. 'launching', 'failed') still blocks — those are real
        // conflicts, not the "already launched" test-mode case.
        if (dryRun && launchData.launch_status === 'launched') {
            return Response.json(
                {
                    message:        'Token is already launched — treated as confirmed for this test run',
                    simulated:      true,
                    alreadyLaunched: true,
                    signature:      `already-launched-${mintId}`,
                    mintId,
                    mintAddress:    launchData.mint_public_key,
                    tokenName:      launchData.token_name,
                    tokenSymbol:    launchData.token_symbol,
                },
                { status: 200 }
            );
        }

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
    // Skipped entirely for dry runs — a simulation must never touch the
    // draft's real launch_status.
    if (!dryRun) {
        const { error: lockError } = await admin
            .rpc('mark_token_launching', { p_mint_id: mintId });

        if (lockError) {
            console.error(`[launch:block0] mark_token_launching error mintId=${mintId}:`, lockError.message);
            return Response.json(
                { error: 'Token is already launching or not in draft state' },
                { status: 409 }
            );
        }
        console.log(`[launch:block0] locked mintId=${mintId} launch_status -> launching`);
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

        console.log(`[launch:block0] keys loaded mintId=${mintId} creator=${creator.publicKey.toBase58()} mint=${mint.publicKey.toBase58()}`);

    } catch (err) {
        // Failed to load keys — revert draft, wipe anything loaded
        creator?.secretKey.fill(0);
        mint?.secretKey.fill(0);

        // Nothing to revert in dry-run mode — the draft was never locked.
        if (!dryRun) {
            const { error: revertErr } = await admin.rpc('fail_token_launch', {
                p_mint_id: mintId,
                p_reason:  `key load failed: ${(err as Error).message}`
            });
            console.log(`[launch:block0] reverted mintId=${mintId} launch_status -> draft (key load failure)${revertErr ? ` — REVERT ITSELF FAILED: ${revertErr.message}` : ''}`);
        }

        const reason = (err as Error).message;
        console.error(`[launch:block0] key load error mintId=${mintId}:`, reason);
        return Response.json(
            { error: `Failed to load signing keys: ${reason}` },
            { status: 500 }
        );
    }

    // ── E. Build, sign, and send/simulate the launch transaction ────────
    let signature: string;
    let simulated = false;
    // soloDevBuy: dev wallet is the only buyer, create+buy in one tx (existing path).
    // bundleLaunch: dev + up to 4 more wallets, one atomic Jito bundle (new path).
    let soloDevBuy   = false;
    let buySolAmount: BN | null = null;
    let buyTokenAmount: BN | null = null;
    let bundleLaunch = false;
    let bundleLegs: { walletId: string; solAmount: BN; tokenAmount: BN; signature: string }[] = [];
    let bundleId: string | null = null;

    try {
        // ── Determine instruction set based on buyer count ────────
        const devWalletId  = launchData.dev_wallet_id;
        const tradeCount   = launchConfig.walletTrades.length;
        soloDevBuy   = tradeCount === 1 && launchConfig.walletTrades[0].walletId === devWalletId;
        bundleLaunch = tradeCount > 1;

        console.log(`[launch:block0] path mintId=${mintId} tradeCount=${tradeCount} soloDevBuy=${soloDevBuy} bundleLaunch=${bundleLaunch} devWalletId=${devWalletId ?? 'null'}`);

        if (bundleLaunch) {
            // ── Dev + up to 4 wallets — one atomic Jito bundle ──────────
            // Tx #1 is create+dev-buy (identical math to soloDevBuy); tx #2-5 are
            // one buy each for the other wallets, priced against a locally-simulated
            // bonding curve (it doesn't exist on-chain until tx #1 lands) using the
            // same sequential constant-product advance as the bundle-trade routes.
            if (tradeCount > MAX_BUNDLE_WALLETS) {
                throw new Error(`At most ${MAX_BUNDLE_WALLETS} wallets (dev + ${MAX_BUNDLE_WALLETS - 1}) can buy in one launch bundle — got ${tradeCount}`);
            }

            const devTrade = launchConfig.walletTrades.find((t) => t.walletId === devWalletId);
            if (!devTrade) {
                throw new Error('Dev wallet must be one of the buyers in a bundled block0 launch');
            }
            const otherTrades = launchConfig.walletTrades.filter((t) => t.walletId !== devWalletId);
            console.log(`[launch:block0:bundle] mintId=${mintId} devWalletId=${devWalletId} otherWalletIds=${otherTrades.map((t) => t.walletId).join(',')}`);

            const bundleWallets = await Promise.all(otherTrades.map(async (t) => ({
                walletId:  t.walletId,
                solAmount: t.buyAmountInSOL,
                keypair:   await getWalletKeypairById(t.walletId),
            })));
            console.log(`[launch:block0:bundle] mintId=${mintId} loaded ${bundleWallets.length} bundle wallet keypairs`);

            try {
                const [global, feeConfig] = await Promise.all([
                    onlineSdk.fetchGlobal(),
                    onlineSdk.fetchFeeConfig(),
                ]);
                console.log(`[launch:block0:bundle] mintId=${mintId} fetched global+feeConfig`);

                // The curve doesn't exist on-chain yet — simulate it locally, seeded
                // with the creator the on-chain program will actually record (createV2
                // sets bonding_curve.creator = the `creator` account we pass it).
                let currentCurve: BondingCurve = {
                    ...newBondingCurve(global),
                    creator:      creator.publicKey,
                    isMayhemMode: false,
                };

                // Tx #1: create + dev buy
                const devSolAmount = devTrade.buyAmountInSOL;
                const devTokenAmount = getBuyTokenAmountFromSolAmount({
                    global,
                    feeConfig,
                    mintSupply:   currentCurve.tokenTotalSupply,
                    bondingCurve: currentCurve,
                    amount:       devSolAmount,
                });
                if (devTokenAmount.isZero()) throw new Error('Zero token output for dev buy');

                const createBuyIxs = await PUMP_SDK.createV2AndBuyInstructions({
                    global,
                    mint:       mint.publicKey,
                    name:       launchInfo.token_name,
                    symbol:     launchInfo.token_symbol,
                    uri:        launchInfo.metadata_uri,
                    creator:    creator.publicKey,
                    user:       creator.publicKey,
                    amount:     devTokenAmount,
                    solAmount:  devSolAmount,
                    mayhemMode: false,
                    cashback:   false,
                });
                currentCurve = advanceBuyCurve(currentCurve, devTokenAmount);
                bundleLegs.push({ walletId: devWalletId!, solAmount: devSolAmount, tokenAmount: devTokenAmount, signature: '' });
                console.log(`[launch:block0:bundle] mintId=${mintId} dev buy built: ${devSolAmount.toString()} lamports -> ${devTokenAmount.toString()} tokens`);

                // Tx #2-N: one buy each, priced against the curve as it will look by
                // the time each lands. The bonding-curve account is likewise not real
                // yet — buyInstructions() only inspects data.length to decide whether
                // to prepend an "extend account" instruction, and createV2's own extend
                // (bundled into createBuyIxs above) already lands it at exactly
                // BONDING_CURVE_NEW_SIZE bytes, so a same-sized synthetic AccountInfo
                // here reproduces that without needing an on-chain read.
                const fakeBondingCurveAccountInfo = {
                    executable: false,
                    owner:      PublicKey.default,
                    lamports:   0,
                    data:       Buffer.alloc(BONDING_CURVE_NEW_SIZE),
                    rentEpoch:  0,
                };

                const bundleIxSets: { keypair: Keypair; ixs: TransactionInstruction[] }[] = [];

                for (const w of bundleWallets) {
                    const tokenAmount = getBuyTokenAmountFromSolAmount({
                        global,
                        feeConfig,
                        mintSupply:   currentCurve.tokenTotalSupply,
                        bondingCurve: currentCurve,
                        amount:       w.solAmount,
                    });
                    if (tokenAmount.isZero()) throw new Error(`Zero token output for wallet ${w.walletId}`);

                    const ixs = await PUMP_SDK.buyInstructions({
                        global,
                        bondingCurveAccountInfo:   fakeBondingCurveAccountInfo,
                        bondingCurve:              currentCurve,
                        associatedUserAccountInfo: null,
                        mint:         mint.publicKey,
                        user:         w.keypair.publicKey,
                        amount:       tokenAmount,
                        solAmount:    w.solAmount,
                        slippage:     bundleSlippage,
                        tokenProgram: TOKEN_2022_PROGRAM_ID,
                    });

                    currentCurve = advanceBuyCurve(currentCurve, tokenAmount);
                    bundleIxSets.push({ keypair: w.keypair, ixs });
                    bundleLegs.push({ walletId: w.walletId, solAmount: w.solAmount, tokenAmount, signature: '' });
                    console.log(`[launch:block0:bundle] mintId=${mintId} wallet ${w.walletId} buy built: ${w.solAmount.toString()} lamports -> ${tokenAmount.toString()} tokens`);
                }

                // ── Build, sign, and submit the 2-5 tx bundle ──────────────
                const { blockhash } = await quicknodeSolana.connection.getLatestBlockhash('confirmed');

                const executor = await QuicknodeJitoExecutor.create({
                    endpoint:     process.env.SOLANA_RPC_URL!,
                    tipLamports:  Number(jitoTipInLamports),
                    simulateOnly: dryRun,
                });
                const tipAccount   = await executor.getTipAccount();
                const tipPublicKey = new PublicKey(tipAccount as string);
                console.log(`[launch:block0:bundle] mintId=${mintId} blockhash=${blockhash} tipAccount=${tipPublicKey.toBase58()} legs=${bundleLegs.length}`);

                const legs: { signers: Keypair[]; payer: PublicKey; ixs: TransactionInstruction[] }[] = [
                    { signers: [creator, mint], payer: creator.publicKey, ixs: createBuyIxs },
                    ...bundleIxSets.map(({ keypair, ixs }) => ({ signers: [keypair], payer: keypair.publicKey, ixs })),
                ];

                const encodedTxs: string[] = [];
                const signerAddresses: string[] = [];

                for (let i = 0; i < legs.length; i++) {
                    const isLast = i === legs.length - 1;
                    const { signers, payer, ixs } = legs[i];
                    const finalIxs = isLast
                        ? [...ixs, SystemProgram.transfer({ fromPubkey: payer, toPubkey: tipPublicKey, lamports: Number(jitoTipInLamports) })]
                        : ixs;

                    const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: finalIxs }).compileToV0Message();
                    const vtx = new VersionedTransaction(msg);
                    vtx.sign(signers);

                    encodedTxs.push(Buffer.from(vtx.serialize()).toString('base64'));
                    signerAddresses.push(payer.toBase58());
                    bundleLegs[i].signature = bs58.encode(vtx.signatures[0]);
                }

                console.log(`[launch:block0:bundle] mintId=${mintId} submitting ${encodedTxs.length} txs, signers=${signerAddresses.join(',')}`);

                const result = await executor.sendPrebuiltBundle(
                    encodedTxs as import('@solana/kit').Base64EncodedWireTransaction[],
                    signerAddresses,
                );

                signature = bundleLegs[0].signature; // tx #1's own signature — the canonical "launch" signature
                simulated = result.simulated;
                bundleId  = result.bundleId || null;
                console.log(`[launch:block0:bundle] mintId=${mintId} bundle result bundleId=${bundleId ?? 'null'} simulated=${simulated} signature=${signature}`);

            } finally {
                for (const w of bundleWallets) w.keypair.secretKey.fill(0);
            }

        } else {
            let instructions: TransactionInstruction[];

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
                buySolAmount   = solAmount;
                buyTokenAmount = tokenAmount;

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
                // tradeCount === 1 but the sole buyer isn't the dev wallet — invalid.
                throw new Error('The sole buyer in a block0 launch must be the dev wallet — add more wallets to form a bundle instead');
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

            if (dryRun) {
                // Real keys, real signature — just never broadcast. Simulation
                // still catches real on-chain errors (funds, program errors, etc).
                // replaceRecentBlockhash avoids a spurious BlockhashNotFound when the
                // RPC's own blockhash cache lags behind what we just fetched — safe
                // here since this transaction is never broadcast.
                const simulation = await quicknodeSolana.connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
                if (simulation.value.err) {
                    throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
                }
                signature = `simulated-${Date.now()}`;
                simulated = true;
            } else {
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
            }
        }

    } catch (err) {
        // Tx failed — wipe keys, revert draft for retry
        creator.secretKey.fill(0);
        mint.secretKey.fill(0);

        console.error(`[launch:block0] FAILED mintId=${mintId} soloDevBuy=${soloDevBuy} bundleLaunch=${bundleLaunch} legsBuilt=${bundleLegs.length}:`, (err as Error).message);

        // Nothing to revert in dry-run mode — the draft was never locked.
        if (!dryRun) {
            const { error: revertErr } = await admin.rpc('fail_token_launch', {
                p_mint_id: mintId,
                p_reason:  `tx failed: ${(err as Error).message}`
            });
            // fail_token_launch only reverts rows currently at 'launching' — if this
            // errors OR the row was already something else (race, or mark_token_launching
            // never actually landed), the token can be left stuck non-'draft' with no
            // further signal. This log is the tripwire for that stuck-state scenario.
            console.log(`[launch:block0] reverted mintId=${mintId} launch_status -> draft${revertErr ? ` — REVERT ITSELF FAILED: ${revertErr.message}` : ''}`);
        }

        // Log the failed buy(s) — dry runs never touch trade_logs (no real trade happened).
        // Bundle failures are all-or-nothing (Jito atomicity) — no signature attached,
        // same convention as app/api/trade/bundle/buy/route.ts's catch-block logging.
        if (soloDevBuy && !dryRun && launchInfo.dev_wallet_id) {
            await logTrade({
                walletId:     launchInfo.dev_wallet_id,
                side:         'BUY',
                exchange:     'pump.fun',
                symbol:       launchInfo.token_symbol,
                toAddress:    launchInfo.mint_public_key,
                mintId,
                amountSol:    buySolAmount ? lamportsBNToSolNumber(buySolAmount) : null,
                status:       'failed',
                errorMessage: (err as Error).message,
            })
        } else if (bundleLaunch && !dryRun && bundleLegs.length > 0) {
            await Promise.all(bundleLegs.map((leg) => logTrade({
                walletId:     leg.walletId,
                side:         'BUY',
                exchange:     'pump.fun',
                symbol:       launchInfo.token_symbol,
                toAddress:    launchInfo.mint_public_key,
                mintId,
                amountSol:    lamportsBNToSolNumber(leg.solAmount),
                quantity:     leg.tokenAmount.toNumber(),
                status:       'failed',
                errorMessage: (err as Error).message,
            })))
        }

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

    // ── E.5 Log the buy(s) ────────────────────────────────────
    // create-only (tradeCount === 0) has nothing to log. Dry runs never touch
    // trade_logs — nothing was broadcast, so there's no real trade to record.
    if (soloDevBuy && !dryRun && launchInfo.dev_wallet_id && buySolAmount && buyTokenAmount) {
        await logTrade({
            walletId:    launchInfo.dev_wallet_id,
            side:        'BUY',
            exchange:    'pump.fun',
            symbol:      launchInfo.token_symbol,
            toAddress:   launchInfo.mint_public_key,
            mintId,
            amountSol:   lamportsBNToSolNumber(buySolAmount),
            quantity:    buyTokenAmount.toNumber(),
            price:       buySolAmount.toNumber() / buyTokenAmount.toNumber(),
            txSignature: signature,
            status:      'confirmed',
        })
    } else if (bundleLaunch && !dryRun) {
        // Each leg gets its own real per-transaction signature (extracted while
        // signing, before submission) rather than the shared Jito bundleId — more
        // useful for after-action correlation than one bundle-wide reference.
        await Promise.all(bundleLegs.map((leg) => logTrade({
            walletId:    leg.walletId,
            side:        'BUY',
            exchange:    'pump.fun',
            symbol:      launchInfo.token_symbol,
            toAddress:   launchInfo.mint_public_key,
            mintId,
            amountSol:   lamportsBNToSolNumber(leg.solAmount),
            quantity:    leg.tokenAmount.toNumber(),
            price:       leg.solAmount.toNumber() / leg.tokenAmount.toNumber(),
            txSignature: leg.signature || null,
            status:      'confirmed',
        })))
    }

    // ── F. Mark launched + retire vanity keypair ───────────────
    // Skipped for dry runs — the draft was never locked, so there's nothing
    // to complete. Simulation success just means the transaction would land.
    if (dryRun) {
        return Response.json(
            {
                message:     'Simulation succeeded — no transaction was broadcast',
                simulated,
                signature,
                bundleId,
                mintId,
                mintAddress: launchData.mint_public_key,
                tokenName:   launchData.token_name,
                tokenSymbol: launchData.token_symbol,
            },
            { status: 200 }
        );
    }

    const { error: completeError } = await admin
        .rpc('complete_token_launch', {
            p_mint_id:      mintId,
            p_tx_signature: signature
        });

    if (completeError) {
        // Token IS launched on-chain but DB update failed — log critical. This also
        // leaves launch_status stuck at 'launching' (complete_token_launch never ran),
        // which is exactly the state that later trips "Token cannot be launched" on retry.
        console.error(
            '[launch:block0] CRITICAL: token launched on-chain but DB update failed — launch_status likely stuck at "launching"',
            { mintId, signature, bundleId, error: completeError.message }
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
    console.log(`[launch:block0] SUCCESS mintId=${mintId} launch_status -> launched signature=${signature} bundleId=${bundleId ?? 'null'}`);
    return Response.json(
        {
            message:     'Token successfully launched',
            mintId,
            mintAddress: launchData.mint_public_key,
            tokenName:   launchData.token_name,
            tokenSymbol: launchData.token_symbol,
            signature,
            bundleId,
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
