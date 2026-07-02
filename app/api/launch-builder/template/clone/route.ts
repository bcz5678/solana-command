import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { templateId, name, tokenMintId } = await req.json()
  if (!templateId) return NextResponse.json({ error: 'templateId required' }, { status: 400 })

  const { data, error } = await supabase.rpc('clone_template_to_config', {
    p_template_id:   templateId,
    p_name:          name        ?? null,
    p_token_mint_id: tokenMintId ?? null,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // returns { config_id, template_id } from the RPC
  return NextResponse.json(data, { status: 201 })
}
