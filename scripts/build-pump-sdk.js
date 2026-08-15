#!/usr/bin/env node
/**
 * Builds @nirholas/pump-sdk's dist/ if it's missing.
 *
 * Installed via `github:nirholas/pump-fun-sdk` — a git dependency with no
 * `prepare` script, so pnpm only ever clones its src/, never builds it. A
 * fresh install (new machine, CI, `rm -rf node_modules`) lands with no
 * dist/ at all, which patch-pump-sdk.js can't fix on its own since it only
 * patches an existing build rather than producing one.
 *
 * Idempotent: skips entirely once both entry points already exist. Run
 * before patch-pump-sdk.js in postinstall — that script depends on dist/
 * existing to have anything to check.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PKG_DIR = path.resolve(__dirname, '..', 'node_modules/@nirholas/pump-sdk');
const CJS_OUT = path.join(PKG_DIR, 'dist/index.js');
const ESM_OUT = path.join(PKG_DIR, 'dist/esm/index.mjs');

if (!fs.existsSync(PKG_DIR)) {
  console.warn('[build-pump-sdk] SKIP — @nirholas/pump-sdk is not installed');
  process.exit(0);
}

if (fs.existsSync(CJS_OUT) && fs.existsSync(ESM_OUT)) {
  console.log('[build-pump-sdk] dist/ already built, skipping');
  process.exit(0);
}

// pump-sdk ships no tsconfig.json of its own. Without one, tsup's dts step
// resolves the nearest ANCESTOR tsconfig — this project's — whose
// isolatedModules/incremental settings aren't compatible with building a
// standalone package (re-exported types fail TS1205, --incremental fails
// TS5074). Written fresh every run since nothing under node_modules persists.
const TSCONFIG = path.join(PKG_DIR, 'tsconfig.json');
fs.writeFileSync(
  TSCONFIG,
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2020',
        module: 'ESNext',
        moduleResolution: 'bundler',
        lib: ['ES2020'],
        declaration: true,
        skipLibCheck: true,
        esModuleInterop: true,
        resolveJsonModule: true,
        strict: true,
      },
      include: ['src'],
    },
    null,
    2,
  ) + '\n',
);

const tsupCli = require.resolve('tsup/dist/cli-default.js', {
  paths: [path.resolve(__dirname, '..')],
});

console.log('[build-pump-sdk] building dist/ via tsup...');
execFileSync(
  process.execPath,
  [tsupCli, 'src/index.ts', '--format', 'cjs,esm', '--dts', '--clean', '--legacy-output'],
  { cwd: PKG_DIR, stdio: 'inherit' },
);

// --legacy-output names the ESM file dist/esm/index.js; the package's own
// exports map requires exactly dist/esm/index.mjs for the "import" condition.
const legacyEsm = path.join(PKG_DIR, 'dist/esm/index.js');
if (fs.existsSync(legacyEsm)) {
  fs.renameSync(legacyEsm, ESM_OUT);
}

if (!fs.existsSync(CJS_OUT) || !fs.existsSync(ESM_OUT)) {
  console.error('[build-pump-sdk] ERROR — build finished but expected output is missing');
  console.error(`[build-pump-sdk] expected: ${CJS_OUT}`);
  console.error(`[build-pump-sdk] expected: ${ESM_OUT}`);
  process.exit(1);
}

console.log('[build-pump-sdk] done');
