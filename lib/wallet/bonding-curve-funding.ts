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
