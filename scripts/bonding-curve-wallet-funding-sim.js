#!/usr/bin/env node
/**
 * Extends bonding-curve-wallet-accumulation-sim.js with real operational
 * overhead per wallet — base tx fee, ATA rent, Jito tip, and (for the dev
 * wallet) token-creation cost — to compute what each wallet actually needs
 * FUNDED, not just its bonding-curve buy cost.
 *
 * Assumes no snipers (curve moves only from this wallet sequence) and a
 * fixed per-wallet Jito tip (real tips vary with launch heat).
 *
 * Usage: node scripts/bonding-curve-wallet-funding-sim.js [walletCapPct] [targetHoldingPct] [solPriceUsd] [jitoTipSol]
 */

const BN = require('bn.js');
const { PublicKey } = require('@solana/web3.js');
const {
  getBuySolAmountFromTokenAmount,
  bondingCurveMarketCap,
  computeFeesBps,
} = require('@nirholas/pump-sdk');

const WALLET_CAP_PCT = Number(process.argv[2] ?? 1);
const TARGET_HOLDING_PCT = Number(process.argv[3] ?? 50);
const SOL_USD = Number(process.argv[4] ?? 97.92);
const JITO_TIP_SOL = Number(process.argv[5] ?? 0.0005);

const BASE_TX_FEE_SOL = 0.000005;      // 5,000 lamports — buy tx signature fee
const TRANSFER_TX_FEE_SOL = 0.000005;  // 5,000 lamports — treasury->wallet funding tx
const ATA_RENT_SOL = 0.00203928;       // rent-exempt SPL token account (165 bytes)
const DEV_CREATION_COST_SOL = 0.02;    // mint + metadata + bonding curve account rent (wallet #1 only)

const TEST_PUBKEY = PublicKey.default;
const CREATOR = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

const global_ = {
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
};
const feeConfig = null;

let curve = {
  virtualTokenReserves: global_.initialVirtualTokenReserves,
  virtualSolReserves: global_.initialVirtualSolReserves,
  realTokenReserves: global_.initialRealTokenReserves,
  realSolReserves: new BN(0),
  tokenTotalSupply: global_.tokenTotalSupply,
  complete: false,
  creator: CREATOR,
  isMayhemMode: false,
  isCashbackCoin: false,
};

const totalSupply = global_.tokenTotalSupply;
const walletCapTokens = totalSupply.muln(WALLET_CAP_PCT * 100).divn(10_000);
const targetTokens = totalSupply.muln(TARGET_HOLDING_PCT * 100).divn(10_000);

function lamportsToSol(bn) { return bn.toNumber() / 1e9; }
function tokensToWhole(bn) { return bn.toNumber() / 1e6; }
function fmtUsd(n) { return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtSol(n) { return n.toFixed(5); }
function fmtTok(bn) { return tokensToWhole(bn).toLocaleString('en-US', { maximumFractionDigits: 0 }); }

function inputAmountFromGross(amount, protocolFeeBps, creatorFeeBps) {
  const totalFeeBps = protocolFeeBps.add(creatorFeeBps);
  return amount.subn(1).muln(10_000).div(totalFeeBps.addn(10_000));
}

console.log(
  `Wallet funding sim — cap ${WALLET_CAP_PCT}%/wallet, target ${TARGET_HOLDING_PCT}% of supply, ` +
  `SOL=$${SOL_USD}, Jito tip=${JITO_TIP_SOL} SOL/wallet, no snipers\n`
);
console.log(
  ['wallet', 'buy cost', 'ATA rent', 'tx fee', 'jito tip', 'dev create', 'req. in wallet', 'req. USD', 'xfer fee', 'cum SOL funded']
    .map((h) => h.padEnd(15)).join('')
);
console.log('-'.repeat(15 * 10));

let cumTokens = new BN(0);
let cumBuyCostSol = 0;
let cumRequiredSol = 0;
let cumTransferFeeSol = 0;
let walletNum = 0;

while (cumTokens.lt(targetTokens)) {
  if (curve.realTokenReserves.isZero()) break;

  walletNum++;
  const remainingToTarget = targetTokens.sub(cumTokens);
  const buyTokens = BN.min(BN.min(walletCapTokens, remainingToTarget), curve.realTokenReserves);

  const { protocolFeeBps, creatorFeeBps } = computeFeesBps({
    global: global_,
    feeConfig,
    mintSupply: global_.tokenTotalSupply,
    virtualSolReserves: curve.virtualSolReserves,
    virtualTokenReserves: curve.virtualTokenReserves,
  });

  const grossCost = getBuySolAmountFromTokenAmount({
    global: global_,
    feeConfig,
    mintSupply: global_.tokenTotalSupply,
    bondingCurve: curve,
    amount: buyTokens,
  });
  const buyCostSol = lamportsToSol(grossCost);

  const inputAmount = inputAmountFromGross(grossCost, protocolFeeBps, creatorFeeBps);
  curve = {
    ...curve,
    virtualSolReserves: curve.virtualSolReserves.add(inputAmount),
    virtualTokenReserves: curve.virtualTokenReserves.sub(buyTokens),
    realTokenReserves: curve.realTokenReserves.sub(buyTokens),
    realSolReserves: curve.realSolReserves.add(inputAmount),
  };

  cumTokens = cumTokens.add(buyTokens);

  const devCreation = walletNum === 1 ? DEV_CREATION_COST_SOL : 0;
  const requiredInWallet = buyCostSol + ATA_RENT_SOL + BASE_TX_FEE_SOL + JITO_TIP_SOL + devCreation;

  cumBuyCostSol += buyCostSol;
  cumRequiredSol += requiredInWallet;
  cumTransferFeeSol += TRANSFER_TX_FEE_SOL;

  console.log(
    [
      walletNum === 1 ? '#1 (dev)' : '#' + walletNum,
      fmtSol(buyCostSol),
      fmtSol(ATA_RENT_SOL),
      fmtSol(BASE_TX_FEE_SOL),
      fmtSol(JITO_TIP_SOL),
      devCreation ? fmtSol(devCreation) : '-',
      fmtSol(requiredInWallet),
      fmtUsd(requiredInWallet * SOL_USD),
      fmtSol(TRANSFER_TX_FEE_SOL),
      fmtSol(cumRequiredSol),
    ].map((c) => String(c).padEnd(15)).join('')
  );
}

const treasuryTotal = cumRequiredSol + cumTransferFeeSol;

console.log('\n--- summary ---');
console.log(`Wallets funded:              ${walletNum} (dev wallet + ${walletNum - 1} buy wallets)`);
console.log(`Aggregate holding:           ${fmtTok(cumTokens)} tokens (${((tokensToWhole(cumTokens) / tokensToWhole(totalSupply)) * 100).toFixed(2)}% of supply)`);
console.log(`Sum of bonding-curve costs:  ${cumBuyCostSol.toFixed(5)} SOL (${fmtUsd(cumBuyCostSol * SOL_USD)})`);
console.log(`Sum of ATA rent (${walletNum} wallets):  ${(ATA_RENT_SOL * walletNum).toFixed(5)} SOL (${fmtUsd(ATA_RENT_SOL * walletNum * SOL_USD)})`);
console.log(`Sum of buy tx fees:          ${(BASE_TX_FEE_SOL * walletNum).toFixed(5)} SOL (${fmtUsd(BASE_TX_FEE_SOL * walletNum * SOL_USD)})`);
console.log(`Sum of Jito tips:            ${(JITO_TIP_SOL * walletNum).toFixed(5)} SOL (${fmtUsd(JITO_TIP_SOL * walletNum * SOL_USD)})`);
console.log(`Dev wallet creation cost:    ${DEV_CREATION_COST_SOL.toFixed(5)} SOL (${fmtUsd(DEV_CREATION_COST_SOL * SOL_USD)})`);
console.log(`Sum required IN wallets:     ${cumRequiredSol.toFixed(5)} SOL (${fmtUsd(cumRequiredSol * SOL_USD)})`);
console.log(`Treasury funding-tx fees:    ${cumTransferFeeSol.toFixed(5)} SOL (${fmtUsd(cumTransferFeeSol * SOL_USD)})`);
console.log(`TOTAL treasury capital:      ${treasuryTotal.toFixed(5)} SOL (${fmtUsd(treasuryTotal * SOL_USD)})`);

const mcapLamports = bondingCurveMarketCap({
  mintSupply: global_.tokenTotalSupply,
  virtualSolReserves: curve.virtualSolReserves,
  virtualTokenReserves: curve.virtualTokenReserves,
});
const pctMigration = (1 - tokensToWhole(curve.realTokenReserves) / tokensToWhole(global_.initialRealTokenReserves)) * 100;
console.log(`Market cap at target:        ${lamportsToSol(mcapLamports).toFixed(2)} SOL (${fmtUsd(lamportsToSol(mcapLamports) * SOL_USD)})`);
console.log(`Migration progress:          ${pctMigration.toFixed(2)}%`);
