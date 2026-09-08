import BN from 'bn.js'
import { PublicKey } from '@solana/web3.js'
import {
  getBuySolAmountFromTokenAmount,
  computeFeesBps,
  type Global,
  type BondingCurve,
} from '@nirholas/pump-sdk'

/**
 * Same math as scripts/bonding-curve-wallet-funding-sim.js, ported for use
 * from the "Fund Launch Wallets" UI. Walks a fresh pump.fun bonding curve
 * wallet-by-wallet, each buying a fixed % of supply, and returns what each
 * wallet actually needs funded (buy cost + ATA rent + tx fee + Jito tip,
 * plus token-creation cost for the dev wallet).
 */

const WALLET_CAP_PCT = 1 // fixed 1% of supply per wallet, sequential

const BASE_TX_FEE_SOL = 0.000005      // 5,000 lamports — buy tx signature fee
const ATA_RENT_SOL = 0.00203928       // rent-exempt SPL token account (165 bytes)
const DEV_CREATION_COST_SOL = 0.02    // mint + metadata + bonding curve account rent
const JITO_TIP_SOL_DEFAULT = 0.0005

const TEST_PUBKEY = PublicKey.default
const CREATOR = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111')

// Mainnet-standard globals (matches pump-sdk's own test fixtures / create_v2 defaults).
const global_: Global = {
  authority: TEST_PUBKEY,
  feeRecipient: TEST_PUBKEY,
  initialVirtualTokenReserves: new BN('1073000000000000'),
  initialVirtualSolReserves: new BN('30000000000'),
  initialRealTokenReserves: new BN('793100000000000'),
  tokenTotalSupply: new BN('1000000000000000'),
  feeBasisPoints: new BN(100),
  creatorFeeBasisPoints: new BN(50),
  feeRecipients: [TEST_PUBKEY],
  mayhemModeEnabled: false,
  reservedFeeRecipients: [TEST_PUBKEY],
  reservedFeeRecipient: TEST_PUBKEY,
} as Global
const feeConfig = null

function inputAmountFromGross(amount: BN, protocolFeeBps: BN, creatorFeeBps: BN): BN {
  const totalFeeBps = protocolFeeBps.add(creatorFeeBps)
  return amount.subn(1).muln(10_000).div(totalFeeBps.addn(10_000))
}

// A dev buy is, by definition, the very first buy a token's bonding curve
// ever sees — so its fee bps can always be computed against the FRESH/
// initial curve state, no live RPC read needed (same reasoning
// computeBondingCurveFunding's own loop already relies on for wallet #1).
function initialDevBuyFeeBps(): { protocolFeeBps: BN; creatorFeeBps: BN } {
  return computeFeesBps({
    global: global_,
    feeConfig,
    mintSupply: global_.tokenTotalSupply,
    virtualSolReserves: global_.initialVirtualSolReserves,
    virtualTokenReserves: global_.initialVirtualTokenReserves,
  })
}

export interface DevBuyFeeEstimate {
  feeLamports:       BN
  /** ATA rent + base tx fee + (mint/metadata/bonding-curve creation rent, if this is the creator wallet) — real costs the same wallet also pays in the same transaction, on top of the pump.fun fee. */
  extraLamports:     BN
  totalCostLamports: BN
  totalFeeBps:       number
}

// Every buyer's own associated token account gets created in the same tx
// (createAssociatedTokenAccountIdempotentInstruction), so every buy — dev or
// bundle wallet — needs this reserved, not just the pump.fun fee.
const ATA_RENT_LAMPORTS = new BN(2_039_280)
const BASE_TX_FEE_LAMPORTS = new BN(5_000)
// Mint + metadata + bonding curve account rent — only the creator/dev wallet
// pays this, since createV2Instruction (token creation) is bundled into the
// SAME transaction as its buy. Matches DEV_CREATION_COST_SOL below.
const DEV_CREATION_COST_LAMPORTS = new BN(20_000_000)

function extraCostLamports(isCreator: boolean): BN {
  return ATA_RENT_LAMPORTS.add(BASE_TX_FEE_LAMPORTS).add(isCreator ? DEV_CREATION_COST_LAMPORTS : new BN(0))
}

/** What a dev-buy input of `buyInputLamports` will actually cost this wallet
 *  once pump.fun's protocol + creator fee AND the same-transaction ATA rent
 *  (plus mint-creation rent, if `isCreator`) are added on top. */
export function estimateDevBuyFee(buyInputLamports: BN, opts: { isCreator?: boolean } = {}): DevBuyFeeEstimate {
  const { protocolFeeBps, creatorFeeBps } = initialDevBuyFeeBps()
  const totalFeeBps = protocolFeeBps.add(creatorFeeBps)
  const feeLamports = buyInputLamports.mul(totalFeeBps).divn(10_000)
  const extraLamports = extraCostLamports(!!opts.isCreator)
  return {
    feeLamports,
    extraLamports,
    totalCostLamports: buyInputLamports.add(feeLamports).add(extraLamports),
    totalFeeBps: totalFeeBps.toNumber(),
  }
}

// Extra headroom beyond the bare minimums extraCostLamports() already
// reserves, same "don't leave zero margin" reasoning as MAX_RESERVE_LAMPORTS
// in strategy-wallet-selector.tsx.
const MAX_BUY_SAFETY_MARGIN_LAMPORTS = new BN(5_000)

/** Largest dev-buy input `availableLamports` can safely cover once the
 *  protocol + creator fee, this wallet's own ATA rent, and (if `isCreator`)
 *  the mint/metadata/bonding-curve creation rent are all added on top —
 *  every one of those is paid by this SAME wallet in the SAME transaction as
 *  the buy, so leaving them out (as this used to) let Max fill the buy
 *  amount right up to the wallet's balance with nothing left for rent,
 *  reliably failing the dev's own create+buy tx. Floor-rounded (never rounds
 *  up), so the result always clears the actual on-chain cost with room to
 *  spare. Doesn't reserve for a Jito tip — if this wallet also pays a bundle
 *  tip, reserve that separately first. */
export function computeMaxDevBuyLamports(availableLamports: BN, opts: { isCreator?: boolean } = {}): BN {
  const reserve = extraCostLamports(!!opts.isCreator).add(MAX_BUY_SAFETY_MARGIN_LAMPORTS)
  const spendable = availableLamports.sub(reserve)
  if (spendable.lten(0)) return new BN(0)
  const { protocolFeeBps, creatorFeeBps } = initialDevBuyFeeBps()
  return inputAmountFromGross(spendable, protocolFeeBps, creatorFeeBps)
}

function lamportsToSol(bn: BN): number {
  return bn.toNumber() / 1e9
}

export type BondingCurveFundingWallet = {
  buyCostSol:      number
  ataRentSol:      number
  txFeeSol:        number
  jitoTipSol:      number
  devCreationSol:  number
  requiredSol:     number // sum of the above, pre-buffer
  bufferedSol:     number // requiredSol with bufferPct applied — fund this amount
}

export type BondingCurveFundingInput = {
  /** Total wallets in the sequence, in the order they should be funded/bought. */
  walletCount: number
  /** If true, the FIRST wallet in the sequence also gets DEV_CREATION_COST_SOL added. */
  includeDevCreationCost: boolean
  jitoTipSol?: number
  /** Safety buffer applied on top of the raw required amount, e.g. 10 for +10%. */
  bufferPct?: number
}

export function computeBondingCurveFunding({
  walletCount,
  includeDevCreationCost,
  jitoTipSol = JITO_TIP_SOL_DEFAULT,
  bufferPct = 10,
}: BondingCurveFundingInput): BondingCurveFundingWallet[] {
  if (walletCount <= 0) return []

  const totalSupply = global_.tokenTotalSupply
  const walletCapTokens = totalSupply.muln(WALLET_CAP_PCT * 100).divn(10_000)
  const bufferMultiplier = 1 + bufferPct / 100

  let curve: BondingCurve = {
    virtualTokenReserves: global_.initialVirtualTokenReserves,
    virtualSolReserves: global_.initialVirtualSolReserves,
    realTokenReserves: global_.initialRealTokenReserves,
    realSolReserves: new BN(0),
    tokenTotalSupply: global_.tokenTotalSupply,
    complete: false,
    creator: CREATOR,
    isMayhemMode: false,
    isCashbackCoin: false,
  } as BondingCurve

  const results: BondingCurveFundingWallet[] = []

  for (let i = 0; i < walletCount; i++) {
    if (curve.realTokenReserves.isZero()) break

    const buyTokens = BN.min(walletCapTokens, curve.realTokenReserves)

    const { protocolFeeBps, creatorFeeBps } = computeFeesBps({
      global: global_,
      feeConfig,
      mintSupply: global_.tokenTotalSupply,
      virtualSolReserves: curve.virtualSolReserves,
      virtualTokenReserves: curve.virtualTokenReserves,
    })

    const grossCost = getBuySolAmountFromTokenAmount({
      global: global_,
      feeConfig,
      mintSupply: global_.tokenTotalSupply,
      bondingCurve: curve,
      amount: buyTokens,
    })
    const buyCostSol = lamportsToSol(grossCost)

    const inputAmount = inputAmountFromGross(grossCost, protocolFeeBps, creatorFeeBps)
    curve = {
      ...curve,
      virtualSolReserves: curve.virtualSolReserves.add(inputAmount),
      virtualTokenReserves: curve.virtualTokenReserves.sub(buyTokens),
      realTokenReserves: curve.realTokenReserves.sub(buyTokens),
      realSolReserves: curve.realSolReserves.add(inputAmount),
    }

    const devCreationSol = i === 0 && includeDevCreationCost ? DEV_CREATION_COST_SOL : 0
    const requiredSol = buyCostSol + ATA_RENT_SOL + BASE_TX_FEE_SOL + jitoTipSol + devCreationSol

    results.push({
      buyCostSol,
      ataRentSol: ATA_RENT_SOL,
      txFeeSol: BASE_TX_FEE_SOL,
      jitoTipSol,
      devCreationSol,
      requiredSol,
      bufferedSol: requiredSol * bufferMultiplier,
    })
  }

  return results
}
