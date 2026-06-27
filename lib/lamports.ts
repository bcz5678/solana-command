import BN from 'bn.js';

const LAMPORTS_PER_SOL = new BN(1_000_000_000);
const SOL_DECIMALS = 9;

// ─── Guards ──────────────────────────────────────────────────────────────────

function assertIntegerString(value: string, label = 'value'): void {
    if (!/^\d+$/.test(value)) {
        throw new RangeError(`lamports.${label}: expected integer string, got "${value}"`);
    }
}

// ─── Conversions TO BN ───────────────────────────────────────────────────────

/** Supabase int8 arrives as a string. This is the canonical entry point. */
export function lamportsStringToBN(lamports: string): BN {
    assertIntegerString(lamports, 'lamportsStringToBN');
    return new BN(lamports);
}

/** bigint from web3.js getBalance() / getMinimumBalanceForRentExemption(). */
export function lamportsBigIntToBN(lamports: bigint): BN {
    return new BN(lamports.toString());
}

/**
 * User-typed SOL string (e.g. "1.5") → lamports BN.
 * Uses pure integer arithmetic — never touches float.
 */
export function solStringToLamports(sol: string): BN {
    if (!/^\d*\.?\d*$/.test(sol) || sol === '' || sol === '.') {
        throw new RangeError(`lamports.solStringToLamports: invalid SOL string "${sol}"`);
    }
    const [whole = '0', frac = ''] = sol.split('.');
    const fracPadded = frac.padEnd(SOL_DECIMALS, '0').slice(0, SOL_DECIMALS);
    return new BN(whole).mul(LAMPORTS_PER_SOL).add(new BN(fracPadded));
}

/**
 * Float SOL amount (e.g. from an external API) → lamports BN. Clamps to 0 instead
 * of throwing when the input is non-finite, negative, or absurdly large — upstream
 * APIs have been observed to return corrupted values (e.g. ~1e23 SOL, when total
 * SOL supply is ~588M). Legitimately large-but-real values (hundreds of millions
 * of SOL, e.g. a stablecoin's market cap) still convert correctly — the lamports
 * BN is built from a digit string, not a JS number, so it never hits BN's
 * safe-integer assertion the way `new BN(hugeNumber)` would.
 */
export function solNumberToLamportsBN(sol: number): BN {
    if (!Number.isFinite(sol) || sol < 0 || sol > 1e9) return new BN(0);
    const lamports = Math.round(sol * 1e9);
    return new BN(lamports.toString());
}

// ─── Conversions FROM BN ─────────────────────────────────────────────────────

/** Write back to Supabase int8 column. */
export function lamportsBNToString(lamports: BN): string {
    return lamports.toString();
}

/** Human-readable SOL with up to 9 decimal places, trailing zeros stripped. */
export function lamportsBNToSolDisplay(lamports: BN): string {
    const whole = lamports.div(LAMPORTS_PER_SOL).toString();
    const remainder = lamports.mod(LAMPORTS_PER_SOL).toString().padStart(SOL_DECIMALS, '0');
    const frac = remainder.replace(/0+$/, '');
    return frac.length > 0 ? `${whole}.${frac}` : whole;
}

/** SOL as a JS number — ONLY for display or logging, never for arithmetic or storage. */
export function lamportsBNToSolNumber(lamports: BN): number {
    return Number(lamportsBNToSolDisplay(lamports));
}

// ─── Convenience re-export ───────────────────────────────────────────────────

export { LAMPORTS_PER_SOL, SOL_DECIMALS };
