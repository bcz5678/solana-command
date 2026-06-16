import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/require-super-admin'
import { AddressLookupTableAccount, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import BN from 'bn.js'
import {
  PUMP_SDK,
  OnlinePumpSdk,
  getSellSolAmountFromTokenAmount,
} from '@nirholas/pump-sdk'
import { JitoExecutor } from '@/lib/jito/clients/jitoExecutor'
import { QuicknodeJitoExecutor } from '@/lib/jito/clients/quicknode-jito-executor'
import { getWalletKeypairById } from '@/lib/vault/get-wallet-by-id'
import { initializeQuickNodeSolana } from '@/app/api/utils/helpers'
import { createClient } from '@/lib/supabase/server'
import type { BundleSellBody } from '@/lib/types/trades'
import type { Keypair } from '@solana/web3.js'
import type { LookupTable } from '@/lib/types/lookup-table'

export const dynamic    = 'force-dynamic'
export const maxDuration = 120

const BLOCK_ENGINE_URL = process.env.JITO_BLOCK_ENGINE_URL ?? 'ny.mainnet.block-engine.jito.wtf'
// QuickNode packed path: 5 txs × 2 wallets each = 10 wallets max
// pump.fun sell instructions are large (~12 accounts each); 2 per tx stays under the 1232-byte limit
// Legacy JitoExecutor path: 4 wallets max (one tx per wallet)
const MAX_BUNDLE_TRADES = 10
const MAX_LEGACY_TRADES = 4
const WALLETS_PER_BATCH = 2  // wallets packed into each Jito transaction

export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  let body: BundleSellBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { feePayerWalletId, jitoTipInLamports, tradesList, useJito = true, useQuicknodeJito = true } = body

  if (!feePayerWalletId || !jitoTipInLamports || !tradesList?.length) {
    return NextResponse.json(
      { error: 'feePayerWalletId, jitoTipInLamports, and tradesList are required' },
      { status: 400 },
    )
  }

  if (tradesList.length > MAX_BUNDLE_TRADES) {
    return NextResponse.json(
      { error: `QuickNode Jito bundles support at most ${MAX_BUNDLE_TRADES} wallets` },
      { status: 400 },
    )
  }

  let feePayerKeypair: Keypair | null = null
  const tradeKeypairs: Keypair[] = []

  try {
    const connection = initializeQuickNodeSolana().connection
    const onlineSdk  = new OnlinePumpSdk(connection)

    // Fetch all keypairs in parallel (shared by all paths)
    const [feePayer, ...walletKps] = await Promise.all([
      getWalletKeypairById(feePayerWalletId),
      ...tradesList.map((t) => getWalletKeypairById(t.walletId)),
    ])
    feePayerKeypair = feePayer
    tradeKeypairs.push(...walletKps)

    // ── QuickNode Lil Jito path (1–20 wallet bundle, packed via ALTs) ──────────
    //
    // All wallets must sell the same mint. Shared pump.fun accounts are compressed
    // via Address Lookup Tables so up to 4 wallets fit in a single transaction.
    // Five packed transactions = 20 wallets per bundle submission.
    //
    // Sell direction (inverse of buy): each sale adds tokens to the curve and
    // removes SOL, so the price falls with each sequential sell.
    // After each sell: virtualTokenReserves ↑, virtualSolReserves ↓
    if (useQuicknodeJito) {
      const mintAddress = tradesList[0].mintAddress
      if (tradesList.some((t) => t.mintAddress !== mintAddress)) {
        throw new Error('useQuicknodeJito requires all trades to sell the same mint')
      }

      const mint = new PublicKey(mintAddress)

      // Sells don't need per-wallet ATA state — one fetchSellState covers all.
      const [global, feeConfig, mintInfo, sellState] = await Promise.all([
        onlineSdk.fetchGlobal(),
        onlineSdk.fetchFeeConfig(),
        connection.getAccountInfo(mint),
        onlineSdk.fetchSellState(mint, tradeKeypairs[0].publicKey),
      ])

      const { bondingCurveAccountInfo, bondingCurve } = sellState

      if (bondingCurve.complete) {
        throw new Error(`Token ${mintAddress} has graduated to AMM — use staggered trade`)
      }

      const tokenProgram = mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID)
        ? TOKEN_2022_PROGRAM_ID
        : TOKEN_PROGRAM_ID

      // Sequential curve simulation — each wallet priced against post-previous-sell state.
      let currentCurve = { ...bondingCurve }
      type WalletIxSet = { wallet: Keypair; ixs: import('@solana/web3.js').TransactionInstruction[] }
      const walletIxSets: WalletIxSet[] = []

      for (let i = 0; i < tradesList.length; i++) {
        const trade       = tradesList[i]
        const tradeWallet = tradeKeypairs[i]
        const tokenAmount = new BN(trade.tokenAmount)

        if (tokenAmount.isZero()) {
          throw new Error(`Zero token amount for wallet ${trade.walletId}`)
        }

        const solAmount = getSellSolAmountFromTokenAmount({
          global,
          feeConfig,
          mintSupply:   currentCurve.tokenTotalSupply,
          bondingCurve: currentCurve,
          amount:       tokenAmount,
        })

        const rawIxs = await PUMP_SDK.sellInstructions({
          global,
          bondingCurveAccountInfo,
          bondingCurve: currentCurve,
          mint,
          user:      tradeWallet.publicKey,
          amount:    tokenAmount,
          solAmount,
          slippage:  trade.slippage,
          tokenProgram,
        })

        // Advance curve: constant product k = virtualSol × virtualToken (sell direction)
        // Tokens enter the curve, SOL exits.
        const virtualSolReceived = currentCurve.virtualSolReserves
          .mul(tokenAmount)
          .div(currentCurve.virtualTokenReserves.add(tokenAmount))

        currentCurve = {
          ...currentCurve,
          virtualSolReserves:   currentCurve.virtualSolReserves.sub(virtualSolReceived),
          virtualTokenReserves: currentCurve.virtualTokenReserves.add(tokenAmount),
          realTokenReserves:    currentCurve.realTokenReserves.add(tokenAmount),
          tokenTotalSupply:     currentCurve.tokenTotalSupply.add(tokenAmount),
        }

        walletIxSets.push({ wallet: tradeWallet, ixs: rawIxs })
      }

      // Resolve ALTs to compress shared pump.fun accounts
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
              payer:          feePayerKeypair!,
              tipLamports:    Number(jitoTipInLamports),
            })
            const allIxs = walletIxSets.flatMap(w => w.ixs)
            idealALTs = await altResolver.resolveOptimalLookupTables(activeTables, allIxs)
          }
        }
      } catch (altErr) {
        console.warn('[bundle/sell] ALT resolution failed, proceeding without lookup tables:', altErr)
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

      // Pack wallets into batches — fee payer signs each tx, trade wallets co-sign
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

        const txIxs = isLastBatch
          ? [...batchIxs, SystemProgram.transfer({
              fromPubkey: feePayerKeypair!.publicKey,
              toPubkey:   tipPublicKey,
              lamports:   Number(jitoTipInLamports),
            })]
          : batchIxs

        const message = new TransactionMessage({
          payerKey:        feePayerKeypair!.publicKey,
          recentBlockhash: blockhash,
          instructions:    txIxs,
        }).compileToV0Message(idealALTs)

        const tx      = new VersionedTransaction(message)
        const signers = [feePayerKeypair!, ...batch.map(({ wallet }) => wallet)]
        tx.sign(signers)

        for (const { wallet } of batch) signerAddresses.push(wallet.publicKey.toBase58())
        encodedTxs.push(Buffer.from(tx.serialize()).toString('base64'))

        console.log(`[bundle/sell] batch[${b}] packed ${batch.length} wallets, ALTs: ${idealALTs.length}`)
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
        const tradeWallet  = tradeKeypairs[i]
        const mint         = new PublicKey(trade.mintAddress)
        const tokenAmount  = new BN(trade.tokenAmount)

        if (tokenAmount.isZero()) {
          throw new Error(`Zero token amount for wallet ${trade.walletId}`)
        }

        const [sellState, global, feeConfig, mintInfo] = await Promise.all([
          onlineSdk.fetchSellState(mint, tradeWallet.publicKey),
          onlineSdk.fetchGlobal(),
          onlineSdk.fetchFeeConfig(),
          connection.getAccountInfo(mint),
        ])

        if (sellState.bondingCurve.complete) {
          throw new Error(`Token ${trade.mintAddress} has graduated to AMM — use staggered trade`)
        }

        const tokenProgram = mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID)
          ? TOKEN_2022_PROGRAM_ID
          : TOKEN_PROGRAM_ID

        const { bondingCurveAccountInfo, bondingCurve } = sellState

        const solAmount = getSellSolAmountFromTokenAmount({
          global,
          feeConfig,
          mintSupply: bondingCurve.tokenTotalSupply,
          bondingCurve,
          amount: tokenAmount,
        })

        const instructions = await PUMP_SDK.sellInstructions({
          global,
          bondingCurveAccountInfo,
          bondingCurve,
          mint,
          user: tradeWallet.publicKey,
          amount: tokenAmount,
          solAmount,
          slippage: trade.slippage,
          tokenProgram,
        })

        return { instructions, wallet: tradeWallet }
      }),
    )

    const executor = new JitoExecutor({
      blockEngineUrl: BLOCK_ENGINE_URL,
      connection,
      payer:          feePayerKeypair,
      tipLamports:    Number(jitoTipInLamports),
    })

    let idealALTs: AddressLookupTableAccount[] = []

    if (useJito) {
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
        console.warn('[bundle/sell] ALT resolution failed, proceeding without lookup tables:', altErr)
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
    console.log('[bundle/sell] useJito=false — submitting directly via sendRawTransaction')

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
      console.log(`[bundle/sell] direct tx sent: ${sig}`)
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
        console.log(`[bundle/sell] direct tx confirmed: ${level}`)
        return NextResponse.json({ success: true, signatures: directSignatures, status: level }, { status: 200 })
      }
    }

    return NextResponse.json(
      { success: false, signatures: directSignatures, error: 'Direct tx not confirmed within 60s' },
      { status: 200 },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Bundle sell failed'
    return NextResponse.json({ error: message }, { status: 500 })
  } finally {
    feePayerKeypair?.secretKey.fill(0)
    for (const kp of tradeKeypairs) kp.secretKey.fill(0)
  }
}
