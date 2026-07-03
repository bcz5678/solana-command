import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Block private/internal IP ranges to prevent SSRF.
// Checked against the resolved hostname in the URL.
const BLOCKED_HOSTNAMES = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1|0\.0\.0\.0)/

const TIMEOUT_MS = 30_000
const MAX_RESPONSE_BYTES = 1024 * 512 // 512 KB

function isSafeUrl(raw: string): boolean {
    let parsed: URL
    try {
        parsed = new URL(raw)
    } catch {
        return false
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    if (BLOCKED_HOSTNAMES.test(parsed.hostname)) return false
    return true
}

export async function POST(req: NextRequest) {
    const supabase = await createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const {
        url,
        authType   = 'none',
        authValue  = '',
        customHeaders = [],
        payload    = {},
    }: {
        url: string
        authType?: 'none' | 'bearer' | 'apiKey'
        authValue?: string
        customHeaders?: { key: string; value: string }[]
        payload?: Record<string, unknown>
    } = body

    if (!url || typeof url !== 'string') {
        return NextResponse.json({ error: 'url is required' }, { status: 400 })
    }
    if (!isSafeUrl(url)) {
        return NextResponse.json({ error: 'Invalid or disallowed URL' }, { status: 400 })
    }

    // Build headers
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Source': 'solana-command-launch-builder',
    }

    if (authType === 'bearer' && authValue) {
        headers['Authorization'] = `Bearer ${authValue}`
    } else if (authType === 'apiKey' && authValue) {
        headers['X-Api-Key'] = authValue
    }

    for (const { key, value } of customHeaders) {
        const trimmed = key.trim()
        if (trimmed) headers[trimmed] = value
    }

    // Proxy POST to external endpoint with timeout
    let response: Response
    try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

        response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
            signal: controller.signal,
        })

        clearTimeout(timer)
    } catch (err: unknown) {
        const isTimeout = err instanceof Error && err.name === 'AbortError'
        return NextResponse.json(
            { error: isTimeout ? `Webhook timed out after ${TIMEOUT_MS / 1000}s` : 'Webhook request failed', detail: String(err) },
            { status: 502 },
        )
    }

    // Read response body, capped to avoid memory issues
    let responseBody: string | null = null
    try {
        const reader = response.body?.getReader()
        if (reader) {
            const chunks: Uint8Array[] = []
            let total = 0
            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                if (value) {
                    total += value.byteLength
                    if (total > MAX_RESPONSE_BYTES) {
                        await reader.cancel()
                        break
                    }
                    chunks.push(value)
                }
            }
            responseBody = new TextDecoder().decode(
                chunks.reduce((acc, c) => {
                    const merged = new Uint8Array(acc.length + c.length)
                    merged.set(acc)
                    merged.set(c, acc.length)
                    return merged
                }, new Uint8Array(0)),
            )
        }
    } catch {
        // Non-fatal — we still have the status
    }

    // Try to parse response as JSON, fall back to raw text
    let parsedBody: unknown = responseBody
    if (responseBody) {
        try { parsedBody = JSON.parse(responseBody) } catch { /* keep as string */ }
    }

    if (!response.ok) {
        return NextResponse.json(
            {
                error: `Webhook returned ${response.status} ${response.statusText}`,
                status: response.status,
                body: parsedBody,
            },
            { status: 502 },
        )
    }

    return NextResponse.json({
        ok: true,
        status: response.status,
        body: parsedBody,
    })
}
