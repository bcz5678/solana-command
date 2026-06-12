// app/api/lookup-tables/create/route.ts

import { NextRequest, NextResponse }   from 'next/server'
import { requireSuperAdmin }           from '@/lib/auth/require-super-admin'
import { createClient }                from '@/lib/supabase/server'
import { getWalletKeypairById }        from '@/lib/wallet/keypair'
import {
  PublicKey,
  Keypair,
  AddressLookupTableProgram,
  TransactionMessage,
  VersionedTransaction,
  SendTransactionError
} from '@solana/web3.js'
import { initializeQuickNodeSolana } from '../../utils/helpers'

interface CreateAltBody {
  authorityWalletId: string     // UUID of the managed authority wallet
  displayName:       string
  description?:      string
  addresses?:        string[]   // optional initial addresses to add
}

export async function POST(req: NextRequest) {

  // ── 1. Auth ────────────────────────────────────────────────
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  const supabase = await createClient()

  // ── 2. Parse + validate ────────────────────────────────────
  let body: CreateAltBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { authorityWalletId, displayName, description, addresses = [] } = body

  if (!authorityWalletId || !displayName) {
    return NextResponse.json(
      { error: 'authorityWalletId and displayName are required' },
      { status: 400 }
    )
  }

  // ── 3. Fetch authority keypair from Vault ──────────────────
  // get_wallet_secret_by_id() — service_role gated, uses admin client
  let authority: Keypair | null = null

  try {
    authority = await getWalletKeypairById(authorityWalletId)
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to load authority keypair: ${(err as Error).message}` },
      { status: 500 }
    )
  }

  if (!authority) {
    return NextResponse.json(
      { error: 'Authority keypair could not be loaded' },
      { status: 500 }
    )
  }

  const authorityPubkey = authority.publicKey.toBase58()

  // ── 4. Create the ALT on-chain ─────────────────────────────
  let altAddress = ''
  let signature  = ''

  const connection = initializeQuickNodeSolana().connection

  try {
    // 'finalized' avoids the "invalid instruction data" preflight error that
    // occurs when the confirmed slot hasn't propagated to all validators yet.
    const slot = await connection.getSlot('finalized')

    const [createIx, lookupTableAddress] =
      AddressLookupTableProgram.createLookupTable({
        authority:  authority.publicKey,
        payer:      authority.publicKey,
        recentSlot: slot
      })

    altAddress = lookupTableAddress.toBase58()

    const instructions = [createIx]

    if (addresses.length > 0) {
      const extendIx = AddressLookupTableProgram.extendLookupTable({
        payer:       authority.publicKey,
        authority:   authority.publicKey,
        lookupTable: lookupTableAddress,
        addresses:   addresses.map(a => new PublicKey(a))
      })
      instructions.push(extendIx)
    }

    const { blockhash } = await connection.getLatestBlockhash('confirmed')

    const message = new TransactionMessage({
      payerKey:        authority.publicKey,
      recentBlockhash: blockhash,
      instructions
    }).compileToV0Message()

    const tx = new VersionedTransaction(message)
    tx.sign([authority])

    signature = await connection.sendTransaction(tx, {
      skipPreflight:       false,
      preflightCommitment: 'confirmed',
      maxRetries:          3
    })

    const latest = await connection.getLatestBlockhash('confirmed')
    await connection.confirmTransaction(
      {
        signature,
        blockhash:            latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight
      },
      'confirmed'
    )

  } catch (err) {
    if (err instanceof SendTransactionError) {
      console.error('[create-alt] Simulation logs:', err.logs)
    }
    authority.secretKey.fill(0)
    return NextResponse.json(
      { error: `ALT creation failed: ${(err as Error).message}` },
      { status: 500 }
    )

  } finally {
    authority.secretKey.fill(0)
  }

  // ── 5. Guard: confirm the transaction was actually sent ────
  if (!signature) {
    console.error('[create-alt] sendTransaction completed without a signature')
    return NextResponse.json(
      { error: 'ALT creation failed: no transaction signature returned' },
      { status: 500 }
    )
  }

  // ── 6. Register the ALT reference in DB ────────────────────
  const { data, error: rpcError } = await supabase
    .rpc('create_lookup_table', {
      p_public_address:    altAddress,
      p_display_name:      displayName,
      p_description:       description ?? null,
      p_chain:             'solana',
      p_authority_address: authorityPubkey,  // ⚠ see note
      p_creation_tx_sig:   signature,
      p_address_count:     addresses.length
    })

  if (rpcError) {
    console.error('[create-alt] DB registration error:', rpcError.message)
    return NextResponse.json(
      {
        error:       'ALT created on-chain but DB registration failed',
        altAddress,
        signature,
        partial:     true
      },
      { status: 500 }
    )
  }

  return NextResponse.json({
    id:          data.id,
    altAddress,
    displayName,
    signature,
    addressCount: addresses.length,
    explorerUrl: `https://solscan.io/account/${altAddress}`
  }, { status: 201 })
}