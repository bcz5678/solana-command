import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/require-super-admin'
import { AddressLookupTableAccount, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import BN from 'bn.js'
import {
  PUMP_SDK,
  OnlinePumpSdk,
  getSellSolAmountFromTokenAmount,
} from '@nirholas/pump-sdk'
import { JitoExecutor } from '@/lib/jito/clients/jitoExecutor'
import { getWalletKeypairById } from '@/lib/vault/get-wallet-by-id'
import { initializeConnection, initializeQuickNodeSolana } from '@/app/api/utils/helpers'
import { createClient } from '@/lib/supabase/server'
import type { BundleSellBody } from '@/lib/types/trades'
import type { Keypair } from '@solana/web3.js'
import type { LookupTable } from '@/lib/types/lookup-table'

export const dynamic    = 'force-dynamic'
export const maxDuration = 120

const BLOCK_ENGINE_URL = process.env.JITO_BLOCK_ENGINE_URL ?? 'mainnet.block-engine.jito.wtf'
const MAX_BUNDLE_TRADES = 4

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

  const { feePayerWalletId, jitoTipInLamports, tradesList } = body

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
    const connection = initializeConnection()
    const onlineSdk  = new OnlinePumpSdk(connection)

    // Fetch all keypairs in parallel
    const [feePayer, ...walletKps] = await Promise.all([
      getWalletKeypairById(feePayerWalletId),
      ...tradesList.map((t) => getWalletKeypairById(t.walletId)),
    ])
    feePayerKeypair = feePayer
    tradeKeypairs.push(...walletKps)

    const { blockhash } = await connection.getLatestBlockhash('confirmed')

    // Build instruction sets per trade (each wallet signs its own tx)
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
          slippage: trade.slippage * 100,
          tokenProgram,
        })

        return { instructions, wallet: tradeWallet }
      }),
    )

    const executor = new JitoExecutor({
      blockEngineUrl: BLOCK_ENGINE_URL,
      connection:     initializeQuickNodeSolana().connection,
      payer:          feePayerKeypair,
      tipLamports:    Number(jitoTipInLamports),
    })

    // Resolve the best ALTs across all instruction sets.
    // Falls back to no compression if the DB fetch fails or no tables are active.
    let idealALTs: AddressLookupTableAccount[] = []
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

    // Build v0 txs: each wallet signs its own tx, ALTs applied where they help
    const tradeTxs: VersionedTransaction[] = tradeData.map(({ instructions, wallet }) => {
      const message = new TransactionMessage({
        payerKey:        wallet.publicKey,
        recentBlockhash: blockhash,
        instructions,
      }).compileToV0Message(idealALTs)

      const tx = new VersionedTransaction(message)
      tx.sign([wallet])
      return tx
    })

    const { bundleId } = await executor.sendPrebuiltTransactions(tradeTxs)
    const status       = await executor.waitForBundleLanding(bundleId)

    return NextResponse.json({ success: true, bundleId, status }, { status: 200 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Bundle sell failed'
    return NextResponse.json({ error: message }, { status: 500 })
  } finally {
    feePayerKeypair?.secretKey.fill(0)
    for (const kp of tradeKeypairs) kp.secretKey.fill(0)
  }
}
