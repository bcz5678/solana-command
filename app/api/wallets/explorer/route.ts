import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/auth/require-super-admin";
import type { WalletRecord } from "@/lib/types/wallet";
import { initializeQuickNodeSolana } from "@/app/api/utils/helpers";
import { fetchWalletBalances } from "@/lib/wallet/balances";

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  let admin, userId
      try {
          ({ admin, userId } = await requireSuperAdmin())
      } catch (e) {
          return e as Response   // the 401 or 403
      }
  
  // ── 2. Use user-JWT client for RPC ─────────────────────────
  // SECURITY DEFINER functions resolve auth.uid() from the JWT —
  // must be createClient(), not createAdminClient()
  const supabase = await createClient()

  // ── 3. Optional filters ────────────────────────────────────
  const { searchParams } = new URL(req.url)
  const targetUserId     = searchParams.get('userId') ?? null
  // Every wallet-picker consumer wants active-only by default (retired
  // wallets shouldn't be selectable for a new trade/transfer/comment) — the
  // Wallet Explorer page is the one exception, passing activeOnly=false so
  // its own Status dropdown can still show retired wallets on request.
  const activeOnly       = searchParams.get('activeOnly') !== 'false'

  const { data: walletTypes,  error: typesError }   =  await supabase.from('wallet_types').select('*');
  const { data: walletOwners, error: groupsError }  =  await supabase.from('wallet_owners').select('*');
  const { data: walletGroups, error: ownersError }  =  await supabase.from('wallet_groups').select('*');


  console.log(`typeRes:  ${walletTypes}`);
  console.log(`ownerRes: ${walletOwners}`);
  console.log(`groupRes: ${walletGroups}`);


  // get_wallets() scopes automatically:
  //   is_super_admin() = true  → returns all wallets (or filtered by targetUserId)
  //   is_super_admin() = false → returns own wallets only (targetUserId ignored)
  const { data: walletResults, error: walletResultsError } = await supabase
    .rpc('get_wallets', {
      target_user_id: targetUserId,   // null = all wallets
      p_active_only:  activeOnly,
    })

  if (walletResultsError) {
    console.error('[get_wallets] error:', walletResultsError.message)
    return NextResponse.json(
      { error: walletResultsError.message },
      { status: 500 }
    )
  }


  const wallets = (walletResults ?? []) as WalletRecord[]

  
  try {
    await fetchWalletBalances(wallets, initializeQuickNodeSolana().connection)
  } catch (error) {
    console.error('[explorer] balance fetch failed:', error)
  }



  return Response.json({
    wallets,
    walletTypes: walletTypes  ?? [],
    owners:      walletOwners ?? [],
    groups:      walletGroups ?? [],
  })
}
