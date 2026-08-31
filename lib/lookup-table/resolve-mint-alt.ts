// lib/lookup-table/resolve-mint-alt.ts
//
// Fast path for bundle-trade routes: if a mint has a dedicated ALT (built via
// POST /api/lookup-table/mint-alt — shared pump.fun accounts + every target
// wallet's ATA), use it directly instead of running generic overlap-scoring
// across every ALT the caller owns. Best-effort — a miss or failure here
// should never block a trade, callers fall back to their existing behavior.

import { Connection, PublicKey, AddressLookupTableAccount } from '@solana/web3.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'

interface LookupTableRow {
    public_address: string
    status:         string
}

export async function resolveMintAlt(
    supabase:    SupabaseClient,
    connection:  Connection,
    mintAddress: string,
): Promise<AddressLookupTableAccount | null> {
    try {
        // get_token_mint_id_by_pubkey is service_role-only — same admin client
        // lib/trades/log.ts uses for the identical mint-address -> mint-id lookup.
        const admin = createAdminClient()
        const { data: mintId } = await admin.rpc('get_token_mint_id_by_pubkey', {
            p_mint_public_key: mintAddress,
        })
        if (!mintId) return null

        // get_lookup_tables resolves auth.uid() from the caller's JWT — request-scoped client.
        const { data: rows } = await supabase.rpc('get_lookup_tables', {
            target_user_id: null,
            p_mint_id:       mintId,
        })
        const row = ((Array.isArray(rows) ? rows : []) as LookupTableRow[])[0]
        if (!row || row.status !== 'active') return null

        const { value } = await connection.getAddressLookupTable(new PublicKey(row.public_address))
        return value
    } catch (err) {
        console.warn('[resolveMintAlt] lookup failed, falling back:', (err as Error).message)
        return null
    }
}
