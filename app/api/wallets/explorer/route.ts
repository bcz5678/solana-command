import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/auth/require-super-admin";
import type { WalletModelDTO } from "@/app/db/models/wallet";

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

  // ── 3. Optional filter by user ────────────────────────────
  const { searchParams } = new URL(req.url)
  const targetUserId     = searchParams.get('userId') ?? null

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
      target_user_id: targetUserId    // null = all wallets
    })

  if (walletResultsError) {
    console.error('[get_wallets] error:', walletResultsError.message)
    return NextResponse.json(
      { error: walletResultsError.message },
      { status: 500 }
    )
  }


  type RawWalletResult = Omit<WalletModelDTO, 'solana_balance_in_lamports'> & {
    solana_balance_in_lamports: string | number | bigint | null
  }

  type WalletRow = Omit<WalletModelDTO, 'solana_balance_in_lamports'> & { solana_balance_in_lamports: string }

  const wallets: WalletRow[] = ((walletResults ?? []) as RawWalletResult[]).map((w) => ({
    id:                         w.id,
    created_at:                 w.created_at,
    public_key:                 w.public_key,
    secret_key:                 w.secret_key,
    wallet_label:               w.wallet_label      ?? null,
    chain:                      w.chain,
    is_active:                  w.is_active,
    owner_record_id:            w.owner_record_id   ?? null,
    role:                       w.role              ?? null,
    can_sign:                   w.can_sign          ?? null,
    can_view:                   w.can_view          ?? null,
    can_share:                  w.can_share         ?? null,
    granted_at:                 w.granted_at        ?? null,
    wallet_type_id:             w.wallet_type_id    ?? null,
    wallet_type:                w.wallet_type       ?? null,
    wallet_group_id:            w.wallet_group_id   ?? null,
    group_name:                 w.group_name        ?? null,
    group_color:                w.group_color       ?? null,
    solana_balance_in_lamports: String(w.solana_balance_in_lamports ?? 0),
    token_holdings:             w.token_holdings    ?? [],
  }))

  return Response.json({
    wallets,
    walletTypes: walletTypes  ?? [],
    owners:      walletOwners ?? [],
    groups:      walletGroups ?? [],
  })
}
