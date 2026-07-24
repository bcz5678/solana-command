#!/usr/bin/env node
/**
 * Simulates buying a fresh pump.fun bonding curve in fixed USD increments
 * until the curve exhausts realTokenReserves (migration trigger), using the
 * exact same math the on-chain program uses (via @nirholas/pump-sdk).
 *
 * Reserve state transitions are NOT provided by the SDK as a single helper —
 * getBuyTokenAmountFromSolAmount only quotes tokens out. This script derives
 * the same `inputAmount` (gross SOL minus proportional protocol+creator fee)
 * the SDK computes internally and applies it to virtual/real reserves itself,
 * so the state fed into each subsequent quote matches what the on-chain
 * program would actually leave behind.
 *
 * Usage: node scripts/bonding-curve-migration-sim.js [stepUsd] [solPriceUsd]
 */

const BN = require('bn.js');
const {
  getBuyTokenAmountFromSolAmount,
  getBuySolAmountFromTokenAmount,
  bondingCurveMarketCap,
  computeFeesBps,
} = require('@nirholas/pump-sdk');

const STEP_USD = Number(process.argv[2] ?? 1000);
const SOL_USD = Number(process.argv[3] ?? 77.62);

const LAMPORTS_PER_SOL = new BN(1_000_000_000);
const TEST_PUBKEY = require('@solana/web3.js').PublicKey.default;
const CREATOR = new (require('@solana/web3.js').PublicKey)('BPFLoaderUpgradeab1e11111111111111111111111');

// Mainnet-standard globals (matches pump-sdk's own test fixtures / create_v2 defaults).
const global_ = {
  authority: TEST_PUBKEY,
  feeRecipient: TEST_PUBKEY,
  initialVirtualTokenReserves: new BN('1073000000000000'), // 1.073B tokens (6dp)
  initialVirtualSolReserves: new BN('30000000000'),        // 30 SOL
  initialRealTokenReserves: new BN('793100000000000'),     // 793.1M tokens (6dp)
  tokenTotalSupply: new BN('1000000000000000'),            // 1B tokens (6dp)
  feeBasisPoints: new BN(100),        // 1% protocol fee (flat fallback)
  creatorFeeBasisPoints: new BN(50),  // 0.5% creator fee (flat fallback)
  feeRecipients: [TEST_PUBKEY],
  mayhemModeEnabled: false,
  reservedFeeRecipients: [TEST_PUBKEY],
  reservedFeeRecipient: TEST_PUBKEY,
};
const feeConfig = null; // null => flat fees above, no tiered discount schedule

// Fresh curve with a real creator set (a launched token always has one — this
// matters because the fee formula only charges creatorFeeBps when
// bondingCurve.creator != default).
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

function usdToLamports(usd) {
  return new BN(Math.round((usd / SOL_USD) * 1e9));
}
function lamportsToSol(bn) {
  return bn.toNumber() / 1e9;
}
function tokensToWhole(bn) {
  return bn.toNumber() / 1e6;
}
function fmtUsd(n) {
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

// Replicates the internal fee-adjusted input the SDK derives from a gross
// SOL amount, so we can apply the *same* delta to virtual/real reserves.
function inputAmountFromGross(amount, protocolFeeBps, creatorFeeBps) {
  const totalFeeBps = protocolFeeBps.add(creatorFeeBps);
  return amount.subn(1).muln(10_000).div(totalFeeBps.addn(10_000));
}

console.log(`pump.fun bonding curve simulation — $${STEP_USD} buys @ SOL=$${SOL_USD}\n`);
console.log(
  ['#', 'spend', 'cum $', 'tokens bought', 'cum tokens', '% supply', 'mcap SOL', 'mcap USD', '% to migration']
    .map((h) => h.padEnd(14)).join('')
);
console.log('-'.repeat(14 * 9));

let cumUsd = 0;
let cumTokens = new BN(0);
let step = 0;
let graduated = false;

while (!graduated && step < 500) {
  step++;
  const { protocolFeeBps, creatorFeeBps } = computeFeesBps({
    global: global_,
    feeConfig,
    mintSupply: global_.tokenTotalSupply,
    virtualSolReserves: curve.virtualSolReserves,
    virtualTokenReserves: curve.virtualTokenReserves,
  });

  const stepLamports = usdToLamports(STEP_USD);
  const quote = getBuyTokenAmountFromSolAmount({
    global: global_,
    feeConfig,
    mintSupply: global_.tokenTotalSupply,
    bondingCurve: curve,
    amount: stepLamports,
  });

  let grossAmount, tokensOut, spendUsd;
  if (quote.gte(curve.realTokenReserves)) {
    // This buy would exhaust (or overshoot) the curve — clamp to exactly what's left.
    tokensOut = curve.realTokenReserves;
    grossAmount = getBuySolAmountFromTokenAmount({
      global: global_,
      feeConfig,
      mintSupply: global_.tokenTotalSupply,
      bondingCurve: curve,
      amount: tokensOut,
    });
    spendUsd = lamportsToSol(grossAmount) * SOL_USD;
    graduated = true;
  } else {
    tokensOut = quote;
    grossAmount = stepLamports;
    spendUsd = STEP_USD;
  }

  const inputAmount = inputAmountFromGross(grossAmount, protocolFeeBps, creatorFeeBps);

  curve = {
    ...curve,
    virtualSolReserves: curve.virtualSolReserves.add(inputAmount),
    virtualTokenReserves: curve.virtualTokenReserves.sub(tokensOut),
    realTokenReserves: curve.realTokenReserves.sub(tokensOut),
    realSolReserves: curve.realSolReserves.add(inputAmount),
  };

  cumUsd += spendUsd;
  cumTokens = cumTokens.add(tokensOut);

  const mcapLamports = bondingCurveMarketCap({
    mintSupply: global_.tokenTotalSupply,
    virtualSolReserves: curve.virtualSolReserves,
    virtualTokenReserves: curve.virtualTokenReserves,
  });
  const mcapSol = lamportsToSol(mcapLamports);
  const mcapUsd = mcapSol * SOL_USD;
  const pctSupply = (tokensToWhole(cumTokens) / tokensToWhole(global_.tokenTotalSupply)) * 100;
  const pctMigration =
    (1 - tokensToWhole(curve.realTokenReserves) / tokensToWhole(global_.initialRealTokenReserves)) * 100;

  console.log(
    [
      String(step),
      fmtUsd(spendUsd),
      fmtUsd(cumUsd),
      tokensToWhole(tokensOut).toLocaleString('en-US', { maximumFractionDigits: 0 }),
      tokensToWhole(cumTokens).toLocaleString('en-US', { maximumFractionDigits: 0 }),
      pctSupply.toFixed(2) + '%',
      mcapSol.toFixed(2),
      fmtUsd(mcapUsd),
      pctMigration.toFixed(2) + '%' + (graduated ? '  ← MIGRATED' : ''),
    ].map((c) => String(c).padEnd(14)).join('')
  );
}

console.log('\n--- summary ---');
console.log(`Buys to migrate:      ${step} x ~$${STEP_USD} (last one partial)`);
console.log(`Total capital spent:  ${fmtUsd(cumUsd)} (${(cumUsd / SOL_USD).toFixed(2)} SOL)`);
console.log(`Total tokens bought:  ${tokensToWhole(cumTokens).toLocaleString('en-US', { maximumFractionDigits: 0 })} (${((tokensToWhole(cumTokens) / tokensToWhole(global_.tokenTotalSupply)) * 100).toFixed(2)}% of supply)`);
const finalMcapLamports = bondingCurveMarketCap({
  mintSupply: global_.tokenTotalSupply,
  virtualSolReserves: curve.virtualSolReserves,
  virtualTokenReserves: curve.virtualTokenReserves,
});
console.log(`Migration market cap: ${lamportsToSol(finalMcapLamports).toFixed(2)} SOL (${fmtUsd(lamportsToSol(finalMcapLamports) * SOL_USD)})`);
