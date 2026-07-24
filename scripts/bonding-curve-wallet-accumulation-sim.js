#!/usr/bin/env node
/**
 * Simulates a multi-wallet accumulation strategy on a fresh pump.fun bonding
 * curve: each wallet buys up to a fixed token cap (e.g. 1% of total supply),
 * repeating with new wallets until the target aggregate holding (e.g. 50% of
 * supply) is reached. Reports SOL/USD cost per wallet and in aggregate, and
 * how far that leaves the curve from migration.
 *
 * Same reserve-update approach as bonding-curve-migration-sim.js: quotes come
 * from @nirholas/pump-sdk's on-chain math (getBuySolAmountFromTokenAmount),
 * and the fee-adjusted input is replicated locally to advance curve state
 * between wallets.
 *
 * Usage: node scripts/bonding-curve-wallet-accumulation-sim.js [walletCapPct] [targetHoldingPct] [solPriceUsd]
 */

const BN = require('bn.js');
const { PublicKey } = require('@solana/web3.js');
const {
  getBuySolAmountFromTokenAmount,
  bondingCurveMarketCap,
  computeFeesBps,
} = require('@nirholas/pump-sdk');

const WALLET_CAP_PCT = Number(process.argv[2] ?? 1);      // max % of total supply per wallet
const TARGET_HOLDING_PCT = Number(process.argv[3] ?? 50); // target aggregate % of total supply
const SOL_USD = Number(process.argv[4] ?? 77.62);

const TEST_PUBKEY = PublicKey.default;
const CREATOR = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

const global_ = {
  authority: TEST_PUBKEY,
  feeRecipient: TEST_PUBKEY,
  initialVirtualTokenReserves: new BN('1073000000000000'), // 1.073B tokens (6dp)
  initialVirtualSolReserves: new BN('30000000000'),        // 30 SOL
  initialRealTokenReserves: new BN('793100000000000'),     // 793.1M tokens (6dp) — migration trigger
  tokenTotalSupply: new BN('1000000000000000'),            // 1B tokens (6dp)
  feeBasisPoints: new BN(100),        // 1% protocol fee (flat fallback)
  creatorFeeBasisPoints: new BN(50),  // 0.5% creator fee (flat fallback)
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
const walletCapTokens = totalSupply.muln(WALLET_CAP_PCT * 100).divn(10_000); // pct with 2dp precision
const targetTokens = totalSupply.muln(TARGET_HOLDING_PCT * 100).divn(10_000);

function lamportsToSol(bn) { return bn.toNumber() / 1e9; }
function tokensToWhole(bn) { return bn.toNumber() / 1e6; }
function fmtUsd(n) { return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 }); }
function fmtTok(bn) { return tokensToWhole(bn).toLocaleString('en-US', { maximumFractionDigits: 0 }); }

function inputAmountFromGross(amount, protocolFeeBps, creatorFeeBps) {
  const totalFeeBps = protocolFeeBps.add(creatorFeeBps);
  return amount.subn(1).muln(10_000).div(totalFeeBps.addn(10_000));
}

console.log(
  `Wallet accumulation sim — cap ${WALLET_CAP_PCT}%/wallet (${fmtTok(walletCapTokens)} tokens), ` +
  `target ${TARGET_HOLDING_PCT}% of supply (${fmtTok(targetTokens)} tokens) @ SOL=$${SOL_USD}\n`
);
console.log(
  ['wallet', 'tokens bought', 'SOL cost', 'USD cost', 'cum tokens', '% supply', 'mcap SOL', 'mcap USD', '% to migration']
    .map((h) => h.padEnd(14)).join('')
);
console.log('-'.repeat(14 * 9));

let cumTokens = new BN(0);
let cumSolLamports = new BN(0);
let walletNum = 0;

while (cumTokens.lt(targetTokens)) {
  if (curve.realTokenReserves.isZero()) {
    console.log('\nCurve exhausted (fully migrated) before reaching target holding.');
    break;
  }

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

  const inputAmount = inputAmountFromGross(grossCost, protocolFeeBps, creatorFeeBps);

  curve = {
    ...curve,
    virtualSolReserves: curve.virtualSolReserves.add(inputAmount),
    virtualTokenReserves: curve.virtualTokenReserves.sub(buyTokens),
    realTokenReserves: curve.realTokenReserves.sub(buyTokens),
    realSolReserves: curve.realSolReserves.add(inputAmount),
  };

  cumTokens = cumTokens.add(buyTokens);
  cumSolLamports = cumSolLamports.add(grossCost);

  const mcapLamports = bondingCurveMarketCap({
    mintSupply: global_.tokenTotalSupply,
    virtualSolReserves: curve.virtualSolReserves,
    virtualTokenReserves: curve.virtualTokenReserves,
  });
  const mcapSol = lamportsToSol(mcapLamports);
  const pctSupply = (tokensToWhole(cumTokens) / tokensToWhole(totalSupply)) * 100;
  const pctMigration =
    (1 - tokensToWhole(curve.realTokenReserves) / tokensToWhole(global_.initialRealTokenReserves)) * 100;

  console.log(
    [
      '#' + walletNum,
      fmtTok(buyTokens),
      lamportsToSol(grossCost).toFixed(3),
      fmtUsd(lamportsToSol(grossCost) * SOL_USD),
      fmtTok(cumTokens),
      pctSupply.toFixed(2) + '%',
      mcapSol.toFixed(2),
      fmtUsd(mcapSol * SOL_USD),
      pctMigration.toFixed(2) + '%',
    ].map((c) => String(c).padEnd(14)).join('')
  );
}

console.log('\n--- summary: reaching target holding ---');
console.log(`Wallets needed:        ${walletNum} (each capped at ${WALLET_CAP_PCT}% = ${fmtTok(walletCapTokens)} tokens)`);
console.log(`Aggregate holding:     ${fmtTok(cumTokens)} tokens (${((tokensToWhole(cumTokens) / tokensToWhole(totalSupply)) * 100).toFixed(2)}% of supply)`);
console.log(`Total capital spent:   ${lamportsToSol(cumSolLamports).toFixed(2)} SOL (${fmtUsd(lamportsToSol(cumSolLamports) * SOL_USD)})`);
const mcapAfterLamports = bondingCurveMarketCap({
  mintSupply: global_.tokenTotalSupply,
  virtualSolReserves: curve.virtualSolReserves,
  virtualTokenReserves: curve.virtualTokenReserves,
});
console.log(`Market cap reached:    ${lamportsToSol(mcapAfterLamports).toFixed(2)} SOL (${fmtUsd(lamportsToSol(mcapAfterLamports) * SOL_USD)})`);
const pctMigrationFinal = (1 - tokensToWhole(curve.realTokenReserves) / tokensToWhole(global_.initialRealTokenReserves)) * 100;
console.log(`Migration progress:    ${pctMigrationFinal.toFixed(2)}%`);

if (!curve.realTokenReserves.isZero()) {
  const remainingTokens = curve.realTokenReserves;
  const remainingCost = getBuySolAmountFromTokenAmount({
    global: global_,
    feeConfig,
    mintSupply: global_.tokenTotalSupply,
    bondingCurve: curve,
    amount: remainingTokens,
  });
  console.log(`\n--- what's left to fully migrate (bought by anyone, at ${WALLET_CAP_PCT}%/wallet cap that'd be ${Math.ceil(tokensToWhole(remainingTokens) / tokensToWhole(walletCapTokens))} more wallets) ---`);
  console.log(`Remaining tokens:      ${fmtTok(remainingTokens)} (${(100 - pctMigrationFinal).toFixed(2)}% of curve's 793.1M)`);
  console.log(`Remaining SOL needed:  ${lamportsToSol(remainingCost).toFixed(2)} SOL (${fmtUsd(lamportsToSol(remainingCost) * SOL_USD)})`);
}
