import { NextRequest, NextResponse } from 'next/server'
import { S3Client, PutObjectCommand, S3ServiceException } from '@aws-sdk/client-s3'
import { createClient } from '@/lib/supabase/server'
import { requireSuperAdmin } from '@/lib/auth/require-super-admin'
import { TokenMint, TokenMetaDTO } from '@/lib/types/token-mint'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {

  // ── 1. Auth ────────────────────────────────────────────────
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  // ── 2. Parse body ──────────────────────────────────────────
  let mintId: string
  try {
    const body = await req.json()
    mintId = body?.mintId
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!mintId) {
    return NextResponse.json({ error: 'mintId is required' }, { status: 400 })
  }

  // ── 3. Fetch token from DB ─────────────────────────────────
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_token_mints', { target_user_id: null })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const token = (data as TokenMint[] | null)?.find(t => t.id === mintId)

  if (!token) {
    return NextResponse.json(
      { error: `Token mint ${mintId} not found or not accessible` },
      { status: 404 }
    )
  }

  if (!token.metadata_uri) {
    return NextResponse.json(
      { error: 'Token has no metadata_uri — upload-meta must be called first' },
      { status: 409 }
    )
  }

  // ── 4. Derive S3 key from metadata_uri ─────────────────────
  // URL format: https://<bucket>.s3.<region>.amazonaws.com/<key>
  const bucketBase = `https://${process.env.AWS_S3_TOKEN_BUCKET_NAME}.s3.${process.env.AWS_S3_REGION}.amazonaws.com/`
  if (!token.metadata_uri.startsWith(bucketBase)) {
    return NextResponse.json(
      { error: 'metadata_uri does not match configured bucket' },
      { status: 422 }
    )
  }
  const s3Key = token.metadata_uri.slice(bucketBase.length)

  // ── 5. Build meta payload matching the original structure ──
  const meta: TokenMetaDTO = {
    name:            token.token_name,
    symbol:          token.token_symbol,
    showName:        true,
    description:     token.description,
    image:           token.logo_url,
    banner:          token.banner_url,
    website:         token.website_url,
    twitter:         token.twitter_url,
    telegram:        token.telegram_handle,
    tiktok:          token.tiktok_url,
    instagram:       token.instagram_url,
    discord:         token.discord_url,
    coin_community:  token.communities_url,
  }

  // ── 6. Overwrite S3 object (PutObject replaces existing) ───
  const s3 = new S3Client({
    region: process.env.AWS_S3_REGION,
    credentials: {
      accessKeyId:     process.env.AWS_S3_ACCESS_KEY!,
      secretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY!,
    },
  })

  try {
    await s3.send(new PutObjectCommand({
      Bucket:      process.env.AWS_S3_TOKEN_BUCKET_NAME,
      Key:         s3Key,
      ContentType: 'application/json',
      Body:        Buffer.from(JSON.stringify(meta)),
    }))
  } catch (caught) {
    if (caught instanceof S3ServiceException) {
      return NextResponse.json(
        { error: `S3 error: ${caught.name}: ${caught.message}` },
        { status: 500 }
      )
    }
    throw caught
  }

  return NextResponse.json(
    { updated: true, url: token.metadata_uri },
    { status: 200 }
  )
}
