import { SiteTemplate } from '@/lib/types/site-template'

export interface SiteTemplateParams {
    title: string
    description: string
}

export enum DomainMode {
    subdomain = "Subdomain",
    custom = "Custom",
}

export type SiteBuilderMode = 'create' | 'edit'

export interface SiteBuilderConfigParams {
    token: TokenMintRef | null
    template: SiteTemplate | null
    domainMode: DomainMode
    subdomain: string
    customDomain: string
    siteTitle: string
    tagline: string
    accentColor: string
}

export type TokenMintRef = {
    id: string
    mint_public_key: string
    token_name: string
    token_symbol: string
    logo_url: string | null
}

export class SiteBuilderConfig implements SiteBuilderConfigParams {
    token: TokenMintRef | null
    template: SiteTemplate | null
    domainMode: DomainMode
    subdomain: string
    customDomain: string
    siteTitle: string
    tagline: string
    accentColor: string

    constructor(params: SiteBuilderConfigParams) {
        this.token = params.token
        this.template = params.template
        this.domainMode = params.domainMode
        this.subdomain = params.subdomain
        this.customDomain = params.customDomain
        this.siteTitle = params.siteTitle
        this.tagline = params.tagline
        this.accentColor = params.accentColor
    }

    copyWith(patch: Partial<SiteBuilderConfigParams>): SiteBuilderConfig {
        return new SiteBuilderConfig({
            // token/template are nullable, so an explicit `null` in the patch must clear them —
            // `??` alone can't tell "explicitly cleared" apart from "not provided".
            token: 'token' in patch ? patch.token ?? null : this.token,
            template: 'template' in patch ? patch.template ?? null : this.template,
            domainMode: patch.domainMode ?? this.domainMode,
            subdomain: patch.subdomain ?? this.subdomain,
            customDomain: patch.customDomain ?? this.customDomain,
            siteTitle: patch.siteTitle ?? this.siteTitle,
            tagline: patch.tagline ?? this.tagline,
            accentColor: patch.accentColor ?? this.accentColor,
        })
    }

    get resolvedDomain(): string {
        return this.domainMode === DomainMode.custom
            ? this.customDomain
            : this.subdomain
                ? `${this.subdomain}.solanacommand.site`
                : ''
    }
}

export function defaultSiteBuilderConfig(): SiteBuilderConfig {
    return new SiteBuilderConfig({
        token: null,
        template: null,
        domainMode: DomainMode.subdomain,
        subdomain: '',
        customDomain: '',
        siteTitle: '',
        tagline: '',
        accentColor: '#3b82f6',
    })
}
