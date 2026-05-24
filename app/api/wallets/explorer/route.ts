import { requireSuperAdmin } from "@/app/api/require-super-admin"; 

export const dynamic = 'force-dynamic'

export async function GET() {
  let admin, userId
      try {
          ({ admin, userId } = await requireSuperAdmin())
      } catch (e) {
          return e as Response   // the 401 or 403
      }
  
  const { data: walletTypes,  error: typesError }   =  await admin.from('wallet_types').select('*');
  const { data: walletOwners, error: groupsError }  =  await admin.from('wallet_owners').select('*');
  const { data: walletGroups, error: ownersError }  =  await admin.from('wallet_groups').select('*');


  console.log(`typeRes:  ${walletTypes}`);
  console.log(`ownerRes: ${walletOwners}`);
  console.log(`groupRes: ${walletGroups}`);


  const { data: walletResults, error: walletResultsError }  =  await admin
      .rpc('get_wallets')

console.log(`walletResults: ${walletResults}`);

  //if (walletResultsError) return new Response(walletResultsError.message, { status: 500 })

  const wallets = (walletResults ?? []).map((w) => ({
    ...w,
    solana_balance_in_lamports: String(w.solana_balance_in_lamports ?? 0),
  }))

  return Response.json({
    wallets,
    walletTypes: walletTypes  ?? [],
    owners:      walletOwners ?? [],
    groups:      walletGroups ?? [],
  })
}
