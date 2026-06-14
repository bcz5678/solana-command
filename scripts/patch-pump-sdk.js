#!/usr/bin/env node
/**
 * Patches @nirholas/pump-sdk to remove a false u64 overflow pre-flight check
 * inside sellInstructions.
 *
 * The pump.fun on-chain program uses 128-bit intermediate arithmetic, not u64,
 * so the SDK's validateSellAmount guard is a false positive that blocks
 * legitimate single-transaction sells for any realistic token position.
 *
 * Verified on-chain: tx
 *   3MsbofWVWWAhEQHeEVEoFaNc4CogH2FToBrEpvG7QQheerf6qcA4Q4VqeTLV2ANq7xfuUHC5o9d5a7hUCui1a4iJ
 * sold 6,847,440 tokens (6.85T raw) in one instruction at 2K mcap.
 * 6,847,440,302,201 × 30,000,000,000 lamports = 2×10²³  >>  u64::MAX (1.84×10¹⁹)
 * yet the transaction succeeded — proving u128 (or wider) is used on-chain.
 *
 * This script is run automatically via the postinstall hook in package.json.
 */

const fs = require('fs');
const path = require('path');

const FILES = [
  'node_modules/@nirholas/pump-sdk/dist/index.js',
  'node_modules/@nirholas/pump-sdk/dist/esm/index.mjs',
];

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
