// app/api/lookup-table/mint-alt/route.ts
//
// Creates one per-mint Address Lookup Table covering every target wallet for
// a launch — shared pump.fun accounts (via lib/lookup-table/mint-alt.ts) plus
// each wallet's ATA for the mint. Meant to run once, post wallet-funding and
// pre-launch (everything needed is derivable before the mint even exists
// on-chain). Bundle buy/sell routes resolve this table directly by mint_id
// instead of running generic overlap-scoring across arbitrary ALTs.

import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin }         from '@/lib/auth/require-super-admin'
import { createClient }              from '@/lib/supabase/server'
import { getWalletKeypairById }      from '@/lib/wallet/keypair'
import {
    PublicKey,
    Keypair,
    AddressLookupTableProgram,
    TransactionMessage,
    VersionedTransaction,
    SendTransactionError,
} from '@solana/web3.js'
import { OnlinePumpSdk } from '@nirholas/pump-sdk'
import { initializeQuickNodeSolana } from '@/app/api/utils/helpers'
import { buildMintAltAddresses, chunkForExtend, MAX_ALT_ADDRESSES } from '@/lib/lookup-table/mint-alt'
import type { WalletRecord } from '@/lib/types/wallet'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

const quicknodeSolana = initializeQuickNodeSolana()
const onlineSdk       = new OnlinePumpSdk(quicknodeSolana.connection)

interface CreateMintAltBody {
    mintId:            string
    walletIds:         string[]  // target trading wallets for this launch
    authorityWalletId: string    // pays for + owns the ALT (typically the dev wallet)
    displayName?:      string
}

interface TokenLaunchDataForAlt {
    mint_public_key:       string
    dev_wallet_public_key: string | null
}

export async function POST(request: NextRequest) {
    try {
        await requireSuperAdmin()
    } catch (res) {
        return res as Response
    }

    let body: CreateMintAltBody
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { mintId, walletIds, authorityWalletId, displayName } = body
    if (!mintId || !walletIds?.length || !authorityWalletId) {
        return NextResponse.json(
            { error: 'mintId, walletIds, and authorityWalletId are required' },
            { status: 400 },
        )
    }

    // SECURITY DEFINER functions resolve auth.uid() from the caller's JWT —
    // must be the request-scoped client, not the service_role admin client.
    // create_lookup_table/get_token_launch_data/get_wallets are all
    // authenticated + is_super_admin()-aware, same as every other RPC here.
    const supabase = await createClient()

    // ── Resolve mint + creator (dev wallet) ─────────────────────
    const { data: launchRows, error: launchErr } = await supabase
        .rpc('get_token_launch_data', { p_mint_id: mintId })
    const launchData = (Array.isArray(launchRows) ? launchRows[0] : launchRows) as TokenLaunchDataForAlt | undefined

    if (launchErr || !launchData?.mint_public_key || !launchData.dev_wallet_public_key) {
        return NextResponse.json(
            { error: `Token or dev wallet not found for mintId: ${launchErr?.message ?? 'not found'}` },
            { status: 404 },
        )
    }

    const mint    = new PublicKey(launchData.mint_public_key)
    const creator = new PublicKey(launchData.dev_wallet_public_key)

    // ── Resolve target wallets' public keys ─────────────────────
    // Resolving specific already-known walletIds, not presenting a picker —
    // must still resolve a wallet that's since been retired, or ALT builds
    // referencing it would silently break.
    const { data: walletResults, error: walletsErr } = await supabase
        .rpc('get_wallets', { target_user_id: null, p_active_only: false })

    if (walletsErr) {
        return NextResponse.json({ error: `Failed to load wallets: ${walletsErr.message}` }, { status: 500 })
    }

    const walletIdSet = new Set(walletIds)
    const wallets = ((walletResults ?? []) as WalletRecord[])
        .filter((w) => walletIdSet.has(w.id))
        .map((w) => new PublicKey(w.public_key))

    if (wallets.length === 0) {
        return NextResponse.json({ error: 'None of the given walletIds matched a known wallet' }, { status: 400 })
    }

    // ── Build the address list ───────────────────────────────────
    let addresses: PublicKey[]
    try {
        const global = await onlineSdk.fetchGlobal()
        addresses = buildMintAltAddresses({ mint, creator, global, wallets })
    } catch (err) {
        return NextResponse.json({ error: `Failed to build address list: ${(err as Error).message}` }, { status: 500 })
    }

    if (addresses.length > MAX_ALT_ADDRESSES) {
        return NextResponse.json(
            { error: `${addresses.length} addresses exceeds the ${MAX_ALT_ADDRESSES}-address ALT cap — reduce the wallet count` },
            { status: 400 },
        )
    }

    // ── Load the authority keypair ───────────────────────────────
    let authority: Keypair
    try {
        authority = await getWalletKeypairById(authorityWalletId)
    } catch (err) {
        return NextResponse.json({ error: `Failed to load authority keypair: ${(err as Error).message}` }, { status: 500 })
    }

    const connection = quicknodeSolana.connection
    const chunks      = chunkForExtend(addresses)
    let altAddress    = ''
    let creationSig   = ''

    try {
        // 'finalized' avoids the "invalid instruction data" preflight error that
        // occurs when the confirmed slot hasn't propagated to all validators yet.
        const slot = await connection.getSlot('finalized')
        const [createIx, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
            authority:  authority.publicKey,
            payer:      authority.publicKey,
            recentSlot: slot,
        })
        altAddress = lookupTableAddress.toBase58()

        // First batch (≤20 addresses) rides in the same tx as creation, exactly
        // like the plain create route — the rest go out as sequential, confirmed
        // extend-only transactions right after.
        const firstBatch = chunks[0] ?? []
        const extendIx = AddressLookupTableProgram.extendLookupTable({
            payer:       authority.publicKey,
            authority:   authority.publicKey,
            lookupTable: lookupTableAddress,
            addresses:   firstBatch,
        })

        const { blockhash } = await connection.getLatestBlockhash('confirmed')
        const message = new TransactionMessage({
            payerKey:        authority.publicKey,
            recentBlockhash: blockhash,
            instructions:    [createIx, extendIx],
        }).compileToV0Message()

        const tx = new VersionedTransaction(message)
        tx.sign([authority])

        creationSig = await connection.sendTransaction(tx, {
            skipPreflight:       false,
            preflightCommitment: 'confirmed',
            maxRetries:          3,
        })

        const latest = await connection.getLatestBlockhash('confirmed')
        await connection.confirmTransaction(
            { signature: creationSig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
            'confirmed',
        )

        let registeredCount = firstBatch.length

        for (let i = 1; i < chunks.length; i++) {
            const batch = chunks[i]
            const extendMoreIx = AddressLookupTableProgram.extendLookupTable({
                payer:       authority.publicKey,
                authority:   authority.publicKey,
                lookupTable: lookupTableAddress,
                addresses:   batch,
            })

            const { blockhash: bh } = await connection.getLatestBlockhash('confirmed')
            const extMessage = new TransactionMessage({
                payerKey:        authority.publicKey,
                recentBlockhash: bh,
                instructions:    [extendMoreIx],
            }).compileToV0Message()

            const extTx = new VersionedTransaction(extMessage)
            extTx.sign([authority])

            const extSig = await connection.sendTransaction(extTx, {
                skipPreflight:       false,
                preflightCommitment: 'confirmed',
                maxRetries:          3,
            })

            const extLatest = await connection.getLatestBlockhash('confirmed')
            await connection.confirmTransaction(
                { signature: extSig, blockhash: extLatest.blockhash, lastValidBlockHeight: extLatest.lastValidBlockHeight },
                'confirmed',
            )

            registeredCount += batch.length
        }

        // ── Register in DB ───────────────────────────────────────
        const { data, error: rpcError } = await supabase.rpc('create_lookup_table', {
            p_public_address:    altAddress,
            p_display_name:      displayName ?? `Launch ALT — ${launchData.mint_public_key.slice(0, 8)}…`,
            p_description:       `Auto-built for ${wallets.length} wallets`,
            p_chain:             'solana',
            p_authority_address: authority.publicKey.toBase58(),
            p_creation_tx_sig:   creationSig,
            p_address_count:     registeredCount,
            p_mint_id:           mintId,
        })

        if (rpcError) {
            console.error('[mint-alt] DB registration error:', rpcError.message)
            return NextResponse.json(
                {
                    error:        'ALT created on-chain but DB registration failed',
                    altAddress,
                    signature:    creationSig,
                    addressCount: registeredCount,
                    partial:      true,
                },
                { status: 500 },
            )
        }

        return NextResponse.json({
            id:           (data as { id: string }).id,
            altAddress,
            signature:    creationSig,
            addressCount: registeredCount,
            walletCount:  wallets.length,
            explorerUrl:  `https://solscan.io/account/${altAddress}`,
        }, { status: 201 })

    } catch (err) {
        if (err instanceof SendTransactionError) {
            console.error('[mint-alt] simulation logs:', err.logs)
        }
        return NextResponse.json(
            { error: `Mint ALT build failed: ${(err as Error).message}`, altAddress: altAddress || undefined },
            { status: 500 },
        )
    } finally {
        authority.secretKey.fill(0)
    }
}
