// Proxies a token image/banner back to the browser so it can be read into a
// File (re-upload on clone). Restricted to our own S3 bucket — this is not a
// general-purpose proxy, so arbitrary URLs are rejected to avoid SSRF.

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const assetUrl = url.searchParams.get('url')

    if (!assetUrl) {
        return Response.json({ error: 'url is required' }, { status: 400 })
    }

    const allowedPrefix = `https://${process.env.AWS_S3_TOKEN_BUCKET_NAME}.s3.${process.env.AWS_S3_REGION}.amazonaws.com/`
    if (!assetUrl.startsWith(allowedPrefix)) {
        return Response.json({ error: 'URL is not a token asset' }, { status: 400 })
    }

    const assetRes = await fetch(assetUrl)
    if (!assetRes.ok) {
        return Response.json({ error: `Failed to fetch asset: ${assetRes.status}` }, { status: 502 })
    }

    return new Response(assetRes.body, {
        status: 200,
        headers: {
            'Content-Type': assetRes.headers.get('content-type') ?? 'application/octet-stream',
        },
    })
}
