#!/usr/bin/env node
/**
 * Patches @nirholas/pump-sdk to remove a false u64 overflow pre-flight check
 * inside sellInstructions — ONLY if the installed version still has it.
 *
 * The pump.fun on-chain program uses 128-bit intermediate arithmetic, not u64,
 * so a validateSellAmount guard derived from u64::MAX is a false positive that
 * blocks legitimate single-transaction sells for any realistic token position.
 *
 * Verified on-chain: tx
 *   3MsbofWVWWAhEQHeEVEoFaNc4CogH2FToBrEpvG7QQheerf6qcA4Q4VqeTLV2ANq7xfuUHC5o9d5a7hUCui1a4iJ
 * sold 6,847,440 tokens (6.85T raw) in one instruction at 2K mcap.
 * 6,847,440,302,201 × 30,000,000,000 lamports = 2×10²³  >>  u64::MAX (1.84×10¹⁹)
 * yet the transaction succeeded — proving u128 (or wider) is used on-chain.
 *
 * As of 2026-08, upstream fixed this properly: maxSafeSellAmount() now derives
 * the limit from u128::MAX with a safety margin, instead of u64::MAX. That's
 * real protection, not a false positive — deleting the call (this script's
 * original strategy) would silently remove it and leave sellInstructions with
 * NO overflow guard at all. So this now checks for the upstream fix's own
 * signature FIRST and skips entirely when present, rather than pattern-
 * matching the call site alone (which doesn't change between the broken and
 * fixed versions — only the math inside validateSellAmount does).
 *
 * This script is run automatically via the postinstall hook in package.json.
 */

const fs = require('fs');
const path = require('path');

const FILES = [
  'node_modules/@nirholas/pump-sdk/dist/index.js',
  'node_modules/@nirholas/pump-sdk/dist/esm/index.mjs',
];

// Present once upstream's own fix landed (maxSafeSellAmount deriving the
// limit from u128::MAX). Survives tsup's default (non-minified) bundling as
// a literal identifier. If this is here, validateSellAmount is real
// protection, not the false positive this script exists to remove.
const FIXED_UPSTREAM_SIGNATURE = 'U128_MAX';

// Sentinel written by this script so we can detect prior runs.
const SENTINEL = '// [patch-pump-sdk] validateSellAmount removed';

// What appears in a fresh install (4-space indent, CJS and ESM builds are identical here).
const NEEDLE = '    validateSellAmount(amount, bondingCurve);\n    const instructions = [];';

// Replacement: sentinel comment + the next line that was already there.
const REPLACED = `    ${SENTINEL}\n    const instructions = [];`;

let allOk = true;

for (const relPath of FILES) {
  const filePath = path.resolve(__dirname, '..', relPath);

  if (!fs.existsSync(filePath)) {
    console.warn(`[patch-pump-sdk] SKIP — file not found: ${relPath}`);
    continue;
  }

  const src = fs.readFileSync(filePath, 'utf8');

  // Upstream's own u128 fix is present — validateSellAmount is real
  // protection now, not a false positive. Leave it alone.
  if (src.includes(FIXED_UPSTREAM_SIGNATURE)) {
    console.log(`[patch-pump-sdk] upstream fix present, nothing to patch: ${relPath}`);
    continue;
  }

  // Already patched by this script.
  if (src.includes(SENTINEL)) {
    console.log(`[patch-pump-sdk] already patched: ${relPath}`);
    continue;
  }

  // Needle present → fresh install, apply patch.
  if (src.includes(NEEDLE)) {
    const patched = src.replace(NEEDLE, REPLACED);
    fs.writeFileSync(filePath, patched, 'utf8');
    console.log(`[patch-pump-sdk] patched: ${relPath}`);
    continue;
  }

  // Neither sentinel nor needle → manually patched or SDK was updated.
  // Check whether validateSellAmount still appears near `const instructions = []`
  // in the sellInstructions function context.
  const stillHasCheck = /validateSellAmount\(amount,\s*bondingCurve\)[\s\S]{0,200}const instructions = \[\]/.test(src);
  if (stillHasCheck) {
    console.error(`[patch-pump-sdk] ERROR — found validateSellAmount but could not match expected context in ${relPath}`);
    console.error(`[patch-pump-sdk] SDK may have changed — review manually and update NEEDLE in this script.`);
    allOk = false;
  } else {
    // validateSellAmount is gone from that context — treat as already patched.
    console.log(`[patch-pump-sdk] already clean (manually patched or SDK updated): ${relPath}`);
  }
}

if (!allOk) {
  process.exit(1);
}
