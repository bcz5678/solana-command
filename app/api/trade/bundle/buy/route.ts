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
import { QuicknodeJitoExecutor, type WalletBundle } from '@/lib/jito/clients/quicknode-jito-executor'
import { AccountRole, type Address, type Instruction } from '@solana/kit'
import { getWalletKeypairById } from '@/lib/vault/get-wallet-by-id'
import { initializeQuickNodeSolana } from '@/app/api/utils/helpers'
import { createClient } from '@/lib/supabase/server'
import type { BundleBuyBody } from '@/lib/types/trades'
import type { Keypair } from '@solana/web3.js'
import type { LookupTable } from '@/lib/types/lookup-table'

// Convert a web3.js v1 TransactionInstruction to a @solana/kit Instruction
function toKitInstruction(ix: import('@solana/web3.js').TransactionInstruction): Instruction {
  return {
    programAddress: ix.programId.toBase58() as Address,
    accounts: ix.keys.map((key) => ({
      address: key.pubkey.toBase58() as Address,
      role: key.isSigner
        ? (key.isWritable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER)
        : (key.isWritable ? AccountRole.WRITABLE : AccountRole.READONLY),
    })),
    data: ix.data.length ? new Uint8Array(ix.data) : undefined,
  }
}

export const dynamic    = 'force-dynamic'
export const maxDuration = 120

const BLOCK_ENGINE_URL = process.env.JITO_BLOCK_ENGINE_URL ?? 'ny.mainnet.block-engine.jito.wtf'
const MAX_BUNDLE_TRADES = 4

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

  const { feePayerWalletId, jitoTipInLamports, tradesList, useJito = true, useQuicknodeJito = true } = body

  if (!feePayerWalletId || !jitoTipInLamports || !tradesList?.length) {
    return NextResponse.json(
      { error: 'feePayerWalletId, jitoTipInLamports, and tradesList are required' },
      { status: 400 },
    )
  }

  if (tradesList.length > MAX_BUNDLE_TRADES) {
    return NextResponse.json(
      { error: `Jito bundles support at most ${MAX_BUNDLE_TRADES} trades per submission` },
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

    // ── QuickNode Lil Jito path (1–4 wallet bundle) ─────────────────────────
    //
    // All wallets must buy the same mint. We fetch shared on-chain data once,
    // then thread the bonding curve state sequentially through each wallet's
    // calculation so every wallet gets an exact price — no slippage inflation needed.
    if (useQuicknodeJito) {
      const mintAddress = tradesList[0].mintAddress
      if (tradesList.some((t) => t.mintAddress !== mintAddress)) {
        throw new Error('useQuicknodeJito requires all trades to buy the same mint')
      }

      const mint = new PublicKey(mintAddress)

      // Fetch global config, fee config, mint info, and each wallet's ATA state
      // all in a single parallel round-trip.
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

      // Sequential curve simulation.
      // Each wallet's buy is calculated against the curve state left by the
      // wallet before it, matching the order transactions execute on-chain.
      // After each buy we advance the virtual reserves using the constant
      // product invariant: k = virtualSol × virtualToken.
      let currentCurve = { ...bondingCurve }
      const wallets: WalletBundle[] = []

      for (let i = 0; i < tradesList.length; i++) {
        const trade      = tradesList[i]
        const tradeWallet = tradeKeypairs[i]
        const solAmount  = new BN(trade.amountInSol)
        const { associatedUserAccountInfo } = buyStates[i]

        const tokenAmount = getBuyTokenAmountFromSolAmount({
          global,
          feeConfig,
          mintSupply: currentCurve.tokenTotalSupply,
          bondingCurve: currentCurve,
          amount: solAmount,
        })

        if (tokenAmount.isZero()) {
          throw new Error(`Zero token output for wallet ${trade.walletId}`)
        }

        const rawIxs = await PUMP_SDK.buyInstructions({
          global,
          bondingCurveAccountInfo,
          bondingCurve: currentCurve,
          associatedUserAccountInfo,
          mint,
          user:        tradeWallet.publicKey,
          amount:      tokenAmount,
          solAmount,
          slippage:    trade.slippage, // exact price per position — original slippage is sufficient
          tokenProgram,
        })

        // Advance curve: constant product formula gives the pre-fee SOL delta
        // that maintains k = virtualSol × virtualToken.
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

        wallets.push({
          secretKey:    tradeWallet.secretKey,
          instructions: rawIxs.map(toKitInstruction),
        })
      }

      const executor = await QuicknodeJitoExecutor.create({
        endpoint:    process.env.SOLANA_RPC_URL!,
        tipLamports: Number(jitoTipInLamports),
      })

      const result = await executor.sendMultiWalletBundle(wallets)
      return NextResponse.json({ success: true, ...result }, { status: 200 })
    }

    // ── Legacy paths: parallel tradeData build ───────────────────────────────
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
        payer:          feePayerKeypair,
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
    feePayerKeypair?.secretKey.fill(0)
    for (const kp of tradeKeypairs) kp.secretKey.fill(0)
  }
}
