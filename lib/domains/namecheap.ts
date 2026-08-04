// lib/domains/namecheap.ts
//
// Minimal Namecheap API client. The Namecheap API responds with XML, so
// small attribute-regex helpers are used here instead of pulling in a full
// XML parser for what is currently a couple of flat, attribute-only response
// shapes (domains.check / users.getPricing / domains.create).

const NAMECHEAP_API_URL = process.env.NAMECHEAP_SANDBOX === 'true'
  ? 'https://api.sandbox.namecheap.com/xml.response'
  : 'https://api.namecheap.com/xml.response'

export interface DomainSearchResult {
  domain:   string
  available: boolean
  price:    number | null
  currency: string | null
}

// ── Low-level request/parse helpers ────────────────────────────

async function resolveClientIp(): Promise<string> {
  // Namecheap requires the calling server's public IP to be whitelisted on
  // the account. Set NAMECHEAP_CLIENT_IP to skip the lookup once that's known.
  if (process.env.NAMECHEAP_CLIENT_IP) return process.env.NAMECHEAP_CLIENT_IP

  const res = await fetch('https://api.ipify.org?format=text')
  if (!res.ok) {
    throw new Error('Unable to resolve outbound IP for the Namecheap API — set NAMECHEAP_CLIENT_IP to skip this lookup')
  }
  return (await res.text()).trim()
}

async function callNamecheap(command: string, params: Record<string, string>): Promise<string> {
  const apiUser = process.env.NAMECHEAP_USERNAME
  const apiKey  = process.env.NAMECHEAP_API_KEY

  if (!apiUser || !apiKey) {
    throw new Error('Namecheap API credentials are not configured (NAMECHEAP_USERNAME / NAMECHEAP_API_KEY)')
  }

  const clientIp = await resolveClientIp()

  const query = new URLSearchParams({
    ApiUser:  apiUser,
    ApiKey:   apiKey,
    UserName: apiUser,
    ClientIp: clientIp,
    Command:  command,
    ...params,
  })

  const res = await fetch(`${NAMECHEAP_API_URL}?${query.toString()}`)
  if (!res.ok) {
    throw new Error(`Namecheap API request failed with status ${res.status}`)
  }
  return res.text()
}

// Extracts every `<Tag attr="a" other="b" />` (or non-self-closing opener) in the document.
function xmlAttrTags(tag: string, xml: string): Record<string, string>[] {
  const tagRe = new RegExp(`<${tag}\\b([^>]*?)\\/?>`, 'g')
  const attrRe = /([\w:]+)="([^"]*)"/g

  const tags: Record<string, string>[] = []
  let tagMatch: RegExpExecArray | null
  while ((tagMatch = tagRe.exec(xml))) {
    const attrs: Record<string, string> = {}
    let attrMatch: RegExpExecArray | null
    attrRe.lastIndex = 0
    while ((attrMatch = attrRe.exec(tagMatch[1]))) {
      attrs[attrMatch[1]] = attrMatch[2]
    }
    tags.push(attrs)
  }
  return tags
}

// Extracts the text content of the first `<Tag>...</Tag>` — for the handful
// of response fields Namecheap sends as element text rather than attributes
// (e.g. <Paging><TotalItems>15</TotalItems>...).
function xmlText(tag: string, xml: string): string | null {
  const m = new RegExp(`<${tag}>([^<]*)<\\/${tag}>`).exec(xml)
  return m ? m[1].trim() : null
}

function isOkResponse(xml: string): boolean {
  return /<ApiResponse[^>]*Status="OK"/.test(xml)
}

function namecheapErrors(xml: string): string[] {
  const re = /<Error(?:\s[^>]*)?>([^<]*)<\/Error>/g
  const errors: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) errors.push(m[1].trim())
  return errors
}

function assertOk(xml: string, fallbackMessage: string) {
  if (!isOkResponse(xml)) {
    const errors = namecheapErrors(xml)
    throw new Error(errors.length > 0 ? errors.join('; ') : fallbackMessage)
  }
}


// ── Pricing ─────────────────────────────────────────────────────

async function getRegistrationPrice(tld: string): Promise<number | null> {
  try {
    const xml = await callNamecheap('namecheap.users.getPricing', {
      ProductType:     'DOMAIN',
      ProductCategory: 'REGISTER',
      ActionName:      'REGISTER',
      ProductName:     tld,
    })
    if (!isOkResponse(xml)) return null

    const prices = xmlAttrTags('Price', xml)
    const oneYear = prices.find((p) => p.Duration === '1' && p.DurationType === 'YEAR') ?? prices[0]
    return oneYear?.Price ? Number(oneYear.Price) : null
  } catch (err) {
    console.error('[namecheap] pricing lookup failed:', err)
    return null
  }
}


// ── Public API ──────────────────────────────────────────────────

const DEFAULT_TLDS = ['com', 'xyz', 'io', 'site', 'app']

export async function searchDomains(baseName: string, tlds: string[] = DEFAULT_TLDS): Promise<DomainSearchResult[]> {
  const cleanBase = baseName.trim().replace(/\.[a-z]{2,}$/i, '')
  const domainList = tlds
    .map((tld) => `${cleanBase}.${tld.replace(/^\./, '')}`)
    .join(',')

  const xml = await callNamecheap('namecheap.domains.check', { DomainList: domainList })
  assertOk(xml, 'Namecheap domain check failed')

  const checks = xmlAttrTags('DomainCheckResult', xml)

  const results: DomainSearchResult[] = []
  for (const attrs of checks) {
    const domain = attrs.Domain
    const available = attrs.Available === 'true'
    const price = available ? await getRegistrationPrice(domain.split('.').slice(1).join('.')) : null

    results.push({
      domain,
      available,
      price,
      currency: price !== null ? 'USD' : null,
    })
  }
  return results
}

// ── Account domain ownership ─────────────────────────────────────

const LIST_PAGE_SIZE = 100

export async function listAccountDomains(): Promise<string[]> {
  const domains: string[] = []
  let page = 1

  while (true) {
    const xml = await callNamecheap('namecheap.domains.getList', {
      Page:     String(page),
      PageSize: String(LIST_PAGE_SIZE),
      ListType: 'ALL',
    })
    assertOk(xml, 'Namecheap domain list lookup failed')

    const entries = xmlAttrTags('Domain', xml)
    domains.push(...entries.map((e) => e.Name).filter(Boolean))

    const totalItems = Number(xmlText('TotalItems', xml) ?? entries.length)
    if (page * LIST_PAGE_SIZE >= totalItems || entries.length === 0) break
    page += 1
  }

  return domains
}

export async function verifyDomainOwnership(domain: string): Promise<boolean> {
  const normalized = domain.trim().toLowerCase()
  const domains = await listAccountDomains()
  return domains.some((d) => d.toLowerCase() === normalized)
}
