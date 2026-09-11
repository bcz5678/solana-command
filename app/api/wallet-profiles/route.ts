import { NextRequest, NextResponse } from 'next/server'
import { S3Client, PutObjectCommand, S3ServiceException } from '@aws-sdk/client-s3'
import { requireSuperAdmin } from '@/lib/auth/require-super-admin'
import { createClient } from '@/lib/supabase/server'
import type { WalletProfile } from '@/lib/types/wallet-profile'

export const dynamic = 'force-dynamic'

const MAX_AVATAR_BYTES = 5 * 1024 * 1024

interface WalletProfileRow {
  wallet_id:          string
  public_key:         string
  label:              string | null
  username:           string | null
  bio:                string | null
  avatar_url:         string | null
  pumpfun_setup:      boolean
  terminal_linked:    boolean
  profile_created_at: string | null
  profile_updated_at: string | null
}

function toWalletProfile(row: WalletProfileRow): WalletProfile {
  return {
    walletId:         row.wallet_id,
    publicKey:        row.public_key,
    label:            row.label,
    username:         row.username,
    bio:              row.bio,
    avatarUrl:        row.avatar_url,
    pumpfunSetup:     row.pumpfun_setup,
    terminalLinked:   row.terminal_linked,
    profileCreatedAt: row.profile_created_at,
    profileUpdatedAt: row.profile_updated_at,
  }
}

// Same bucket/credentials as app/api/token-mint/upload-image/route.ts — this
// is another kind of image asset, no dedicated "wallet avatars" bucket exists.
// Namespaced by wallet + timestamp so re-uploading never collides with (or
// overwrites) a previous avatar for the same or a different wallet.
function avatarKey(walletId: string, filename: string): string {
  const safe = filename
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/^\.+/, '')
    .slice(0, 80) || 'avatar'
  return `wallet-profiles/${walletId}/${Date.now()}-${safe}`
}

async function uploadAvatar(walletId: string, image: File): Promise<string> {
  const s3Client = new S3Client({
    region: process.env.AWS_S3_REGION,
    credentials: {
      accessKeyId:     process.env.AWS_S3_ACCESS_KEY!,
      secretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY!,
    },
  })

  const key = avatarKey(walletId, image.name)
  await s3Client.send(new PutObjectCommand({
    Bucket:      process.env.AWS_S3_TOKEN_BUCKET_NAME,
    Key:         key,
    ContentType: image.type,
    Body:        Buffer.from(await image.arrayBuffer()),
  }))

  return `https://${process.env.AWS_S3_TOKEN_BUCKET_NAME}.s3.${process.env.AWS_S3_REGION}.amazonaws.com/${key}`
}

export async function GET() {
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_wallet_profiles', { target_user_id: null })

  if (error) {
    console.error('[api/wallet-profiles] get_wallet_profiles error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ profiles: ((data ?? []) as WalletProfileRow[]).map(toWalletProfile) })
}

export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  const formData = await req.formData()
  const walletId = formData.get('walletId') as string | null
  if (!walletId) {
    return NextResponse.json({ error: 'walletId is required' }, { status: 400 })
  }

  const username        = (formData.get('username') as string | null)?.trim() || null
  const bio              = (formData.get('bio') as string | null)?.trim() || null
  const pumpfunSetupRaw   = formData.get('pumpfunSetup') as string | null
  const terminalLinkedRaw = formData.get('terminalLinked') as string | null
  const avatar            = formData.get('avatar') as File | null

  let avatarUrl: string | null = null
  if (avatar && avatar.size > 0) {
    if (!avatar.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Avatar must be an image file' }, { status: 400 })
    }
    if (avatar.size > MAX_AVATAR_BYTES) {
      return NextResponse.json({ error: `Avatar must be under ${MAX_AVATAR_BYTES / (1024 * 1024)}MB` }, { status: 413 })
    }
    try {
      avatarUrl = await uploadAvatar(walletId, avatar)
    } catch (caught) {
      if (caught instanceof S3ServiceException) {
        console.error('[api/wallet-profiles] S3 upload error:', caught.name, caught.message)
        return NextResponse.json({ error: `S3 error: ${caught.name}: ${caught.message}` }, { status: 500 })
      }
      throw caught
    }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('upsert_wallet_profile', {
    p_wallet_id:       walletId,
    p_username:        username,
    p_bio:             bio,
    p_avatar_url:      avatarUrl,
    p_pumpfun_setup:   pumpfunSetupRaw   == null ? null : pumpfunSetupRaw   === 'true',
    p_terminal_linked: terminalLinkedRaw == null ? null : terminalLinkedRaw === 'true',
  })

  if (error) {
    console.error('[api/wallet-profiles] upsert_wallet_profile error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, avatarUrl, ...(data as { id: string }) })
}

export async function DELETE(req: NextRequest) {
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  const { searchParams } = new URL(req.url)
  const walletId = searchParams.get('walletId')
  if (!walletId) {
    return NextResponse.json({ error: 'walletId is required' }, { status: 400 })
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('delete_wallet_profile', { p_wallet_id: walletId })

  if (error) {
    console.error('[api/wallet-profiles] delete_wallet_profile error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
