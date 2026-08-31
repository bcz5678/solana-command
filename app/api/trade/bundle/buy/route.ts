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
import { logTrade } from '@/lib/trades/log'
import { fetchPumpCoinApi } from '@/lib/pumpfun/pump-api'
import { lamportsBNToSolNumber } from '@/lib/lamports'
import { resolveMintAlt } from '@/lib/lookup-table/resolve-mint-alt'
import { packWalletsBySize } from '@/lib/jito/pack-wallets'
import { maybeEnqueueCommentAfterBuy } from '@/lib/pumpfun/comment-scheduler'

export const dynamic    = 'force-dynamic'
export const maxDuration = 120

const BLOCK_ENGINE_URL = process.env.JITO_BLOCK_ENGINE_URL ?? 'ny.mainnet.block-engine.jito.wtf'
// QuickNode packed path: wallets-per-transaction is no longer fixed — packWalletsBySize
// packs greedily against the real serialized tx size, which a mint's dedicated ALT
// (lib/lookup-table/mint-alt.ts) shrinks dramatically vs. the old ~2-wallets/tx ceiling.
// MAX_BUNDLE_TRADES is just an input-validation ceiling; JITO_MAX_BUNDLE_TXS (5) is the
// hard limit actually enforced after packing, since exact per-tx density depends on ALT presence.
const MAX_BUNDLE_TRADES = 50
const MAX_LEGACY_TRADES = 4
const JITO_MAX_BUNDLE_TXS = 5

// Bundle routes only ever handle a live (non-graduated) bonding curve — a
// graduated mint throws before reaching any trade logic below — so every
// trade logged from this route is unconditionally 'pump.fun'.
const bundleSymbolCache = new Map<string, string>()
async function resolveBundleSymbol(mint: PublicKey): Promise<string> {
  const key = mint.toBase58()
  const cached = bundleSymbolCache.get(key)
  if (cached) return cached
  const symbol = (await fetchPumpCoinApi(mint))?.symbol ?? key.slice(0, 4).toUpperCase()
  bundleSymbolCache.set(key, symbol)
  return symbol
}

interface WalletTradeMeta {
  walletId:    string
  mintAddress: string
  solAmount:   BN
  tokenAmount: BN
  slippage:    number
}

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

  const { jitoTipInLamports, tradesList, useJito = true, useQuicknodeJito = true, dryRun, autoComment } = body

  function scheduleAutoComments() {
    if (!autoComment?.enabled) return
    for (const meta of walletTradeMeta) {
      if (!meta) continue
      void maybeEnqueueCommentAfterBuy(meta.walletId, meta.mintAddress, autoComment, 'bundle_buy')
    }
  }

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
  // Indexed (not pushed) so entries always line up with `tradesList`/signatures
  // order even when populated from a concurrent Promise.all (legacy path below).
  const walletTradeMeta: WalletTradeMeta[] = new Array(tradesList.length)

  async function logWalletTrades(
    status: 'confirmed' | 'pending' | 'failed',
    getSignature: (i: number) => string | null,
    errorMessage?: string,
  ) {
    await Promise.all(walletTradeMeta.map(async (m, i) => {
      if (!m) return
      const symbol = await resolveBundleSymbol(new PublicKey(m.mintAddress))
      await logTrade({
        walletId:    m.walletId,
        side:        'BUY',
        exchange:    'pump.fun',
        symbol,
        toAddress:   m.mintAddress,
        amountSol:   lamportsBNToSolNumber(m.solAmount),
        quantity:    m.tokenAmount.toNumber(),
        price:       m.solAmount.toNumber() / m.tokenAmount.toNumber(),
        txSignature: getSignature(i),
        status,
        slippageBps: Math.round(m.slippage * 10_000),
        errorMessage,
      })
    }))
  }

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
        walletTradeMeta[i] = {
          walletId:    trade.walletId,
          mintAddress: trade.mintAddress,
          solAmount,
          tokenAmount,
          slippage:    trade.slippage,
        }
      }

      // Resolve ALTs to compress shared pump.fun accounts (bondingCurve, global, etc.)
      // Fast path: this mint may already have a dedicated ALT (built via
      // POST /api/lookup-table/mint-alt — shared pump.fun accounts + every
      // target wallet's ATA) — use it directly instead of overlap-scoring
      // across every ALT the caller owns. Falls back to the generic resolver
      // for mints that never got one built.
      let idealALTs: AddressLookupTableAccount[] = []
      const supabase = await createClient()
      const mintAlt = await resolveMintAlt(supabase, connection, mintAddress)
      if (mintAlt) {
        idealALTs = [mintAlt]
      } else {
        try {
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
      }

      const executor = await QuicknodeJitoExecutor.create({
        endpoint:     process.env.SOLANA_RPC_URL!,
        tipLamports:  Number(jitoTipInLamports),
        simulateOnly: dryRun,
      })

      const [{ blockhash }, tipAccount] = await Promise.all([
        connection.getLatestBlockhash('confirmed'),
        executor.getTipAccount(),
      ])

      const tipPublicKey = new PublicKey(tipAccount as string)

      // Pack wallets into batches — each batch's first wallet pays tx fee; last wallet overall
      // pays tip inline. Greedy, size-driven packing (not a fixed wallets/tx count) — see
      // lib/jito/pack-wallets.ts for why: with idealALTs resolved, far more wallets fit per tx.
      const batches: WalletIxSet[][] = packWalletsBySize(walletIxSets, blockhash, idealALTs)

      if (batches.length > JITO_MAX_BUNDLE_TXS) {
        throw new Error(
          `${tradesList.length} wallets need ${batches.length} transactions even with ALT compression — ` +
          `Jito bundles cap at ${JITO_MAX_BUNDLE_TXS}. Reduce the wallet count or split into multiple bundle calls.`
        )
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

      // Skip logging simulated/dry-run bundles — nothing landed on-chain.
      if (!result.simulated) {
        await logWalletTrades('confirmed', () => result.bundleId)
        scheduleAutoComments()
      }

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

        walletTradeMeta[i] = {
          walletId:    trade.walletId,
          mintAddress: trade.mintAddress,
          solAmount,
          tokenAmount,
          slippage:    trade.slippage,
        }

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

      const supabase = await createClient()
      const legacyMintAlt = tradesList[0] ? await resolveMintAlt(supabase, connection, tradesList[0].mintAddress) : null
      if (legacyMintAlt) {
        idealALTs = [legacyMintAlt]
      } else {
        try {
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

      await logWalletTrades('confirmed', (i) => signatures[i] ?? bundleId)
      scheduleAutoComments()

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
        await logWalletTrades('confirmed', (i) => directSignatures[i] ?? null)
        scheduleAutoComments()
        return NextResponse.json({ success: true, signatures: directSignatures, status: level }, { status: 200 })
      }
    }

    await logWalletTrades('pending', (i) => directSignatures[i] ?? null, 'Direct tx not confirmed within 60s')
    return NextResponse.json(
      { success: false, signatures: directSignatures, error: 'Direct tx not confirmed within 60s' },
      { status: 200 },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Bundle buy failed'
    if (walletTradeMeta.some(Boolean)) {
      await logWalletTrades('failed', () => null, message)
    }
    return NextResponse.json({ error: message }, { status: 500 })
  } finally {
    for (const kp of tradeKeypairs) kp.secretKey.fill(0)
  }
}
