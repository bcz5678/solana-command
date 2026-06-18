// Proxies a token image/banner back to the browser so it can be read into a
// File (re-upload or download on clone). Browser `fetch()` can't read bytes
// from most external CDNs (no CORS — they're built for <img> tags, not XHR),
// so this route fetches server-side instead. Since the target URL is
// attacker-influenced (any token's off-chain metadata can point anywhere),
// it's validated against SSRF: only http(s), only public IPs (resolved DNS
// checked, including through redirects), only image/* responses.

import dns from 'node:dns/promises'
import net from 'node:net'
import { requireSuperAdmin } from '@/lib/auth/require-super-admin'

export const dynamic = 'force-dynamic'

function isPrivateIp(ip: string): boolean {
    if (net.isIPv4(ip)) {
        const [a, b] = ip.split('.').map(Number)
        if (a === 10) return true
        if (a === 127) return true
        if (a === 0) return true
        if (a === 169 && b === 254) return true
        if (a === 172 && b >= 16 && b <= 31) return true
        if (a === 192 && b === 168) return true
        if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
        return false
    }
    const lower = ip.toLowerCase()
    if (lower === '::1' || lower === '::') return true
    if (lower.startsWith('fe80')) return true // link-local
    if (/^fc|^fd/.test(lower)) return true     // unique local fc00::/7
    if (lower.startsWith('::ffff:')) return isPrivateIp(lower.slice('::ffff:'.length))
    return false
}

async function isPrivateHostname(hostname: string): Promise<boolean> {
    if (hostname === 'localhost') return true
    if (net.isIP(hostname)) return isPrivateIp(hostname)
    try {
        const addresses = await dns.lookup(hostname, { all: true })
        return addresses.length === 0 || addresses.some(a => isPrivateIp(a.address))
    } catch {
        return true // unresolvable -> treat as unsafe
    }
}

// Fetches the URL, manually following redirects so every hop (not just the
// first) gets re-validated against private IPs before being requested.
async function safeFetch(initialUrl: string, maxRedirects = 3): Promise<Response> {
    let currentUrl = initialUrl

    for (let i = 0; i <= maxRedirects; i++) {
        const parsed = new URL(currentUrl)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error('Unsupported URL protocol')
        }
        if (await isPrivateHostname(parsed.hostname)) {
            throw new Error('URL resolves to a non-public address')
        }

        const res = await fetch(currentUrl, { redirect: 'manual' })

        if (res.status >= 300 && res.status < 400) {
            const location = res.headers.get('location')
            if (!location) throw new Error('Redirect with no Location header')
            currentUrl = new URL(location, currentUrl).toString()
            continue
        }

        return res
    }

    throw new Error('Too many redirects')
}

export async function GET(request: Request): Promise<Response> {
    try {
        await requireSuperAdmin()
    } catch (res) {
        return res as Response
    }

    const url = new URL(request.url)
    const assetUrl = url.searchParams.get('url')

    if (!assetUrl) {
        return Response.json({ error: 'url is required' }, { status: 400 })
    }

    let assetRes: Response
    try {
        assetRes = await safeFetch(assetUrl)
    } catch (err) {
        return Response.json(
            { error: err instanceof Error ? err.message : 'Failed to fetch asset' },
            { status: 400 }
        )
    }

    if (!assetRes.ok) {
        return Response.json({ error: `Failed to fetch asset: ${assetRes.status}` }, { status: 502 })
    }

    const contentType = assetRes.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/')) {
        return Response.json({ error: 'Asset is not an image' }, { status: 415 })
    }

    return new Response(assetRes.body, {
        status: 200,
        headers: { 'Content-Type': contentType },
    })
}
