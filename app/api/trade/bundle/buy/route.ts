import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/require-super-admin'
import { AddressLookupTableAccount, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import BN from 'bn.js'
import {
  PUMP_SDK,
  OnlinePumpSdk,
  getBuyTokenAmountFromSolAmount,
} from '@nirholas/pump-sdk'
import { JitoExecutor } from '@/lib/jito/clients/jitoExecutor'
import { QuicknodeJitoExecutor } from '@/lib/jito/clients/quicknode-jito-executor'
import { getWalletKeypairById } from '@/lib/vault/get-wallet-by-id'
import { initializeQuickNodeSolana } from '@/app/api/utils/helpers'
import { createClient } from '@/lib/supabase/server'
import type { BundleBuyBody } from '@/lib/types/trades'
import type { Keypair } from '@solana/web3.js'
import type { LookupTable } from '@/lib/types/lookup-table'

export const dynamic    = 'force-dynamic'
export const maxDuration = 120

const BLOCK_ENGINE_URL = process.env.JITO_BLOCK_ENGINE_URL ?? 'ny.mainnet.block-engine.jito.wtf'
// QuickNode packed path: 5 txs × 2 wallets each = 10 wallets max
// pump.fun buy instructions are large (~12 accounts each); 2 per tx stays under the 1232-byte limit
// Legacy JitoExecutor path: 4 wallets max (one tx per wallet, Jito 5-tx limit minus tip tx)
const MAX_BUNDLE_TRADES    = 10
const MAX_LEGACY_TRADES    = 4
const WALLETS_PER_BATCH    = 2  // wallets packed into each Jito transaction

export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  let body: BundleBuyBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { jitoTipInLamports, tradesList, useJito = true, useQuicknodeJito = true } = body

  if (!jitoTipInLamports || !tradesList?.length) {
    return NextResponse.json(
      { error: 'jitoTipInLamports and tradesList are required' },
      { status: 400 },
    )
  }

  if (tradesList.length > MAX_BUNDLE_TRADES) {
    return NextResponse.json(
      { error: `Jito bundles support at most ${MAX_BUNDLE_TRADES} trades per submission` },
      { status: 400 },
    )
  }

  const tradeKeypairs: Keypair[] = []

  try {
    const connection = initializeQuickNodeSolana().connection
    const onlineSdk  = new OnlinePumpSdk(connection)

    // Fetch all trade keypairs in parallel
    const walletKps = await Promise.all(
      tradesList.map((t) => getWalletKeypairById(t.walletId)),
    )
    tradeKeypairs.push(...walletKps)

    // ── QuickNode Lil Jito path (1–20 wallet bundle, packed via ALTs) ──────────
    //
    // All wallets must buy the same mint. Shared pump.fun accounts are compressed
    // via Address Lookup Tables so up to 4 wallets fit in a single transaction.
    // Five packed transactions = 20 wallets per bundle submission.
    //
    // Sequential curve simulation threads each wallet's buy against the post-
    // previous-buy state, eliminating SlippageExceeded errors without inflating slippage.
    if (useQuicknodeJito) {
      const mintAddress = tradesList[0].mintAddress
      if (tradesList.some((t) => t.mintAddress !== mintAddress)) {
        throw new Error('useQuicknodeJito requires all trades to buy the same mint')
      }

      const mint = new PublicKey(mintAddress)

      // Parallel round-trip: shared config + per-wallet ATA state
      const [global, feeConfig, mintInfo, ...buyStates] = await Promise.all([
        onlineSdk.fetchGlobal(),
        onlineSdk.fetchFeeConfig(),
        connection.getAccountInfo(mint),
        ...tradeKeypairs.map((kp) => onlineSdk.fetchBuyState(mint, kp.publicKey)),
      ])

      const { bondingCurveAccountInfo, bondingCurve } = buyStates[0]

      if (bondingCurve.complete) {
        throw new Error(`Token ${mintAddress} has graduated to AMM — use staggered trade`)
      }

      const tokenProgram = mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID)
        ? TOKEN_2022_PROGRAM_ID
        : TOKEN_PROGRAM_ID

      // Sequential curve simulation — each wallet priced against post-previous-buy state.
      let currentCurve = { ...bondingCurve }
      type WalletIxSet = { wallet: Keypair; ixs: import('@solana/web3.js').TransactionInstruction[] }
      const walletIxSets: WalletIxSet[] = []

      for (let i = 0; i < tradesList.length; i++) {
        const trade       = tradesList[i]
        const tradeWallet = tradeKeypairs[i]
        const solAmount   = new BN(trade.amountInSol)
        const { associatedUserAccountInfo } = buyStates[i]

        const tokenAmount = getBuyTokenAmountFromSolAmount({
          global,
          feeConfig,
          mintSupply:   currentCurve.tokenTotalSupply,
          bondingCurve: currentCurve,
          amount:       solAmount,
        })

        if (tokenAmount.isZero()) {
          throw new Error(`Zero token output for wallet ${trade.walletId}`)
        }

        const rawIxs = await PUMP_SDK.buyInstructions({
          global,
          bondingCurveAccountInfo,
          bondingCurve:              currentCurve,
          associatedUserAccountInfo,
          mint,
          user:        tradeWallet.publicKey,
          amount:      tokenAmount,
          solAmount,
          slippage:    trade.slippage,
          tokenProgram,
        })

        // Advance curve: constant product k = virtualSol × virtualToken
        const virtualSolCost = currentCurve.virtualSolReserves
          .mul(tokenAmount)
          .div(currentCurve.virtualTokenReserves.sub(tokenAmount))

        currentCurve = {
          ...currentCurve,
          virtualSolReserves:   currentCurve.virtualSolReserves.add(virtualSolCost),
          virtualTokenReserves: currentCurve.virtualTokenReserves.sub(tokenAmount),
          realTokenReserves:    currentCurve.realTokenReserves.sub(tokenAmount),
          tokenTotalSupply:     currentCurve.tokenTotalSupply.sub(tokenAmount),
        }

        walletIxSets.push({ wallet: tradeWallet, ixs: rawIxs })
      }

      // Resolve ALTs to compress shared pump.fun accounts (bondingCurve, global, etc.)
      let idealALTs: AddressLookupTableAccount[] = []
      try {
        const supabase = await createClient()
        const { data, error } = await supabase.rpc('get_lookup_tables', { target_user_id: null })
        if (!error && data) {
          const activeTables = (data as unknown as LookupTable[]).filter(t => t.status === 'active')
          if (activeTables.length > 0) {
            const altResolver = new JitoExecutor({
              blockEngineUrl: BLOCK_ENGINE_URL,
              connection,
              payer:          tradeKeypairs[0],
              tipLamports:    Number(jitoTipInLamports),
            })
            const allIxs = walletIxSets.flatMap(w => w.ixs)
            idealALTs = await altResolver.resolveOptimalLookupTables(activeTables, allIxs)
          }
        }
      } catch (altErr) {
        console.warn('[bundle/buy] ALT resolution failed, proceeding without lookup tables:', altErr)
      }

      const executor = await QuicknodeJitoExecutor.create({
        endpoint:    process.env.SOLANA_RPC_URL!,
        tipLamports: Number(jitoTipInLamports),
      })

      const [{ blockhash }, tipAccount] = await Promise.all([
        connection.getLatestBlockhash('confirmed'),
        executor.getTipAccount(),
      ])

      const tipPublicKey = new PublicKey(tipAccount as string)

      // Pack wallets into batches — each batch's first wallet pays tx fee; last wallet overall pays tip inline
      const batches: WalletIxSet[][] = []
      for (let i = 0; i < walletIxSets.length; i += WALLETS_PER_BATCH) {
        batches.push(walletIxSets.slice(i, i + WALLETS_PER_BATCH))
      }

      const signerAddresses: string[] = []
      const encodedTxs: string[] = []

      for (let b = 0; b < batches.length; b++) {
        const batch       = batches[b]
        const isLastBatch = b === batches.length - 1
        const batchIxs    = batch.flatMap(({ ixs }) => ixs)
        const batchPayer  = batch[0].wallet
        const lastWallet  = batch[batch.length - 1].wallet

        const txIxs = isLastBatch
          ? [...batchIxs, SystemProgram.transfer({
              fromPubkey: lastWallet.publicKey,
              toPubkey:   tipPublicKey,
              lamports:   Number(jitoTipInLamports),
            })]
          : batchIxs

        const message = new TransactionMessage({
          payerKey:        batchPayer.publicKey,
          recentBlockhash: blockhash,
          instructions:    txIxs,
        }).compileToV0Message(idealALTs)

        const tx      = new VersionedTransaction(message)
        const signers = batch.map(({ wallet }) => wallet)
        tx.sign(signers)

        for (const { wallet } of batch) signerAddresses.push(wallet.publicKey.toBase58())
        encodedTxs.push(Buffer.from(tx.serialize()).toString('base64'))

        console.log(`[bundle/buy] batch[${b}] packed ${batch.length} wallets, ALTs: ${idealALTs.length}`)
      }

      const result = await executor.sendPrebuiltBundle(
        encodedTxs as import('@solana/kit').Base64EncodedWireTransaction[],
        signerAddresses,
      )
      return NextResponse.json({ success: true, ...result }, { status: 200 })
    }

    // ── Legacy JitoExecutor path (≤4 wallets, one tx per wallet) ────────────
    if (tradesList.length > MAX_LEGACY_TRADES) {
      return NextResponse.json(
        { error: `Legacy Jito path supports at most ${MAX_LEGACY_TRADES} wallets — enable useQuicknodeJito for 20` },
        { status: 400 },
      )
    }

    const tradeData = await Promise.all(
      tradesList.map(async (trade, i) => {
        const tradeWallet = tradeKeypairs[i]
        const mint        = new PublicKey(trade.mintAddress)
        const solAmount   = new BN(trade.amountInSol)

        const [buyState, global, feeConfig, mintInfo] = await Promise.all([
          onlineSdk.fetchBuyState(mint, tradeWallet.publicKey),
          onlineSdk.fetchGlobal(),
          onlineSdk.fetchFeeConfig(),
          connection.getAccountInfo(mint),
        ])

        if (buyState.bondingCurve.complete) {
          throw new Error(`Token ${trade.mintAddress} has graduated to AMM — use staggered trade`)
        }

        const tokenProgram = mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID)
          ? TOKEN_2022_PROGRAM_ID
          : TOKEN_PROGRAM_ID

        const { bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo } = buyState

        const tokenAmount = getBuyTokenAmountFromSolAmount({
          global,
          feeConfig,
          mintSupply: bondingCurve.tokenTotalSupply,
          bondingCurve,
          amount: solAmount,
        })

        if (tokenAmount.isZero()) throw new Error(`Zero token output for wallet ${trade.walletId}`)

        const instructions = await PUMP_SDK.buyInstructions({
          global,
          bondingCurveAccountInfo,
          bondingCurve,
          associatedUserAccountInfo,
          mint,
          user:      tradeWallet.publicKey,
          amount:    tokenAmount,
          solAmount,
          slippage:  trade.slippage,
          tokenProgram,
        })

        return { instructions, wallet: tradeWallet }
      }),
    )

    // Resolve the best ALTs across all instruction sets.
    let idealALTs: AddressLookupTableAccount[] = []

    if (useJito) {
      const executor = new JitoExecutor({
        blockEngineUrl: BLOCK_ENGINE_URL,
        connection:     connection,
        payer:          tradeKeypairs[0],
        tipLamports:    Number(jitoTipInLamports),
      })

      try {
        const supabase = await createClient()
        const { data, error } = await supabase.rpc('get_lookup_tables', { target_user_id: null })
        if (!error && data) {
          const activeTables = (data as unknown as LookupTable[]).filter(t => t.status === 'active')
          if (activeTables.length > 0) {
            const allInstructions = tradeData.flatMap(d => d.instructions)
            idealALTs = await executor.resolveOptimalLookupTables(activeTables, allInstructions)
          }
        }
      } catch (altErr) {
        console.warn('[bundle/buy] ALT resolution failed, proceeding without lookup tables:', altErr)
      }

      const [{ blockhash }, tipAccount] = await Promise.all([
        connection.getLatestBlockhash('confirmed'),
        executor.resolveTipAccount(),
      ])

      const tradeTxs: VersionedTransaction[] = tradeData.map(({ instructions, wallet }, i) => {
        const isLast = i === tradeData.length - 1
        const ixs = isLast
          ? [
              ...instructions,
              SystemProgram.transfer({
                fromPubkey: wallet.publicKey,
                toPubkey:   tipAccount,
                lamports:   Number(jitoTipInLamports),
              }),
            ]
          : instructions

        const message = new TransactionMessage({
          payerKey:        wallet.publicKey,
          recentBlockhash: blockhash,
          instructions:    ixs,
        }).compileToV0Message(idealALTs)
        const tx = new VersionedTransaction(message)
        tx.sign([wallet])
        return tx
      })

      const { bundleId, signatures } = await executor.sendPrebuiltTransactionsWithInlineTip(tradeTxs)
      const status = await executor.waitForBundleLanding(bundleId, signatures)

      return NextResponse.json({ success: true, bundleId, status }, { status: 200 })
    }

    // ── Direct submission (diagnostic / non-Jito path) ───────────────────────
    console.log('[bundle/buy] useJito=false — submitting directly via sendRawTransaction')

    const { blockhash: directBlockhash } = await connection.getLatestBlockhash('confirmed')

    const directTxs: VersionedTransaction[] = tradeData.map(({ instructions, wallet }) => {
      const message = new TransactionMessage({
        payerKey:        wallet.publicKey,
        recentBlockhash: directBlockhash,
        instructions,
      }).compileToV0Message(idealALTs)
      const tx = new VersionedTransaction(message)
      tx.sign([wallet])
      return tx
    })

    const directSignatures: string[] = []
    for (const tx of directTxs) {
      const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight:       false,
        preflightCommitment: 'confirmed',
        maxRetries:          3,
      })
      console.log(`[bundle/buy] direct tx sent: ${sig}`)
      directSignatures.push(sig)
    }

    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 2_000))
      const statuses = await connection.getSignatureStatuses(directSignatures)
      const confirmed = statuses.value.find(
        s => s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized'),
      )
      if (confirmed) {
        const level = confirmed.confirmationStatus!
        console.log(`[bundle/buy] direct tx confirmed: ${level}`)
        return NextResponse.json({ success: true, signatures: directSignatures, status: level }, { status: 200 })
      }
    }

    return NextResponse.json(
      { success: false, signatures: directSignatures, error: 'Direct tx not confirmed within 60s' },
      { status: 200 },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Bundle buy failed'
    return NextResponse.json({ error: message }, { status: 500 })
  } finally {
    for (const kp of tradeKeypairs) kp.secretKey.fill(0)
  }
}
