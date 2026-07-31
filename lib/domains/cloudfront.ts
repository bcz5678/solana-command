// lib/domains/cloudfront.ts

import {
  CloudFrontClient,
  ListDistributionsCommand,
  GetDistributionConfigCommand,
} from '@aws-sdk/client-cloudfront'

export interface CloudFrontDistributionSummary {
  id:           string
  domainName:   string   // *.cloudfront.net
  url:          string   // https://<domainName> — reachable ahead of DNS/alias propagation
  aliases:      string[] // CNAMEs already attached to this distribution
  originDomain: string   // e.g. bucket.s3.amazonaws.com
  originPath:   string   // current origin path — reassigning this distribution overwrites it
  etag:         string   // required as If-Match when later updating this distribution's config
  enabled:      boolean
  status:       string
}

function client(): CloudFrontClient {
  return new CloudFrontClient({
    region: 'us-east-1', // CloudFront is a global service; the SDK still requires a region
    credentials: {
      accessKeyId:     process.env.AWS_S3_ACCESS_KEY!,
      secretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY!,
    },
  })
}

interface DistributionListing {
  id:         string
  domainName: string
  url:        string
  aliases:    string[]
  enabled:    boolean
  status:     string
}

async function listDistributionIds(): Promise<DistributionListing[]> {
  const cf = client()
  const results: DistributionListing[] = []
  let marker: string | undefined

  do {
    const res = await cf.send(new ListDistributionsCommand({ Marker: marker }))
    const items = res.DistributionList?.Items ?? []

    for (const item of items) {
      const domainName = item.DomainName ?? ''
      results.push({
        id:         item.Id ?? '',
        domainName,
        url:        domainName ? `https://${domainName}` : '',
        aliases:    item.Aliases?.Items ?? [],
        enabled:    item.Enabled ?? false,
        status:     item.Status ?? 'Unknown',
      })
    }

    marker = res.DistributionList?.IsTruncated ? res.DistributionList?.NextMarker : undefined
  } while (marker)

  return results
}

export async function listDistributions(): Promise<CloudFrontDistributionSummary[]> {
  const cf = client()
  const listings = await listDistributionIds()

  // ListDistributions' DistributionSummary carries the origin path but not
  // the config ETag — and the ETag is required as If-Match on any later
  // update — so pull the authoritative config (ETag + origin path together)
  // per distribution here rather than mixing two sources of truth.
  const results: CloudFrontDistributionSummary[] = []
  for (const listing of listings) {
    const configRes = await cf.send(new GetDistributionConfigCommand({ Id: listing.id }))
    const origin = configRes.DistributionConfig?.Origins?.Items?.[0]

    results.push({
      ...listing,
      originDomain: origin?.DomainName ?? '',
      originPath:   origin?.OriginPath ?? '',
      etag:         configRes.ETag ?? '',
    })
  }

  return results
}
