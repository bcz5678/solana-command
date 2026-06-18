import { CreateTokenFormInput } from '@/components/tokens/create/create-token-form'
import { TokenCreationSteps, StepStatus } from '@/components/tokens/create/create-token-progress-dialog'
import { ClaimVanityResponse } from '@/lib/types/responses'
import { TokenMetaDTO } from '@/lib/types/token-mint'

export interface SubmitCreateTokenResult {
    ok:     boolean
    error?: string
}

export async function submitCreateToken(
    data:       CreateTokenFormInput,
    logoFile:   File,
    bannerFile: File | null,
    setStep:    (key: keyof TokenCreationSteps, status: StepStatus) => void,
): Promise<SubmitCreateTokenResult> {

    // Step 1 — Claim vanity mint
    setStep('claimVanityMint', 'loading')

    const vanityMintResponse = await fetch('/api/token-mint/claim-vanity', { method: 'POST' })

    if (!vanityMintResponse.ok) {
        setStep('claimVanityMint', 'error')
        return { ok: false, error: 'No vanity keypairs available.' }
    }

    const { publicKey: contractAddress, keypairId: vanityId }: ClaimVanityResponse =
        await vanityMintResponse.json()

    setStep('claimVanityMint', 'success')

    // Step 2 — Upload token image
    setStep('uploadTokenImage', 'loading')

    const ext = logoFile.name.split('.').pop()

    const renamedImage = new File(
        [logoFile],
        `${data.symbol}_${contractAddress.slice(0, 7)}_logo.${ext}`,
        { type: logoFile.type }
    )

    const imageForm = new FormData()
    imageForm.append('image', renamedImage)

    const uploadImageResponse = await fetch('/api/token-mint/upload-image', {
        method: 'POST',
        body: imageForm,
    })

    if (!uploadImageResponse.ok) {
        setStep('uploadTokenImage', 'error')
        return { ok: false, error: 'Error uploading logo.' }
    }
    const { url: imageUrl } = await uploadImageResponse.json()
    setStep('uploadTokenImage', 'success')

    // Step 3 — Upload banner image (optional)
    let bannerUrl: string | null = null
    if (bannerFile) {
        setStep('uploadBannerImage', 'loading')
        const bannerExt = bannerFile.name.split('.').pop()
        const renamedBanner = new File(
            [bannerFile],
            `${data.symbol}_${contractAddress.slice(0, 7)}_banner.${bannerExt}`,
            { type: bannerFile.type }
        )
        const bannerForm = new FormData()
        bannerForm.append('image', renamedBanner)
        const uploadBannerResponse = await fetch('/api/token-mint/upload-image', {
            method: 'POST',
            body: bannerForm,
        })
        if (!uploadBannerResponse.ok) {
            setStep('uploadBannerImage', 'error')
            return { ok: false, error: 'Error uploading banner.' }
        }
        const { url: bUrl } = await uploadBannerResponse.json()
        bannerUrl = bUrl
        setStep('uploadBannerImage', 'success')
    } else {
        setStep('uploadBannerImage', 'success')
    }

    // Step 4 — Upload token meta to AWS
    setStep('uploadTokenMeta', 'loading')

    const uploadMetaResponse = await fetch('/api/token-mint/upload-meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            filename: `${data.symbol}_${contractAddress.slice(0, 7)}_meta.json`,
            meta: {
                name: data.name,
                symbol: data.symbol,
                showName: true,
                description: data.description,
                image: imageUrl,
                banner: bannerUrl,
                website: data.websiteUrl,
                twitter: data.twitterUrl,
                telegram: data.telegramHandle,
                tiktok: data.tiktokUrl,
                instagram: data.instagramUrl,
                discord: data.discordUrl,
                coin_community: data.communitiesUrl,
            } satisfies TokenMetaDTO,
        }),
    })

    if (!uploadMetaResponse.ok) {
        setStep('uploadTokenMeta', 'error')
        return { ok: false, error: 'Error uploading token metadata.' }
    }

    const { url: tokenMetaUrl } = await uploadMetaResponse.json()
    setStep('uploadTokenMeta', 'success')

    // Step 5 — Build token & store in DB
    setStep('saveToken', 'loading')

    const buildTokenResponse = await fetch('/api/token-mint/build', {
        method: 'POST',
        body: JSON.stringify({
            keypairId: vanityId,
            devWalletId: data.creatorWallet,
            tokenName: data.name,
            tokenSymbol: data.symbol,
            description: data.description,
            logoUrl: imageUrl,
            bannerUrl,
            websiteUrl: data.websiteUrl,
            twitterUrl: data.twitterUrl,
            telegramHandle: data.telegramHandle,
            tiktokUrl: data.tiktokUrl,
            instagramUrl: data.instagramUrl,
            discordUrl: data.discordUrl,
            communitiesUrl: data.communitiesUrl,
            metadataUri: tokenMetaUrl,
        }),
    })

    if (!buildTokenResponse.ok) {
        setStep('saveToken', 'error')
        return { ok: false, error: 'Error building token.' }
    }

    setStep('saveToken', 'success')

    // Step 6 — Update vanity mint
    setStep('updateVanityMint', 'loading')

    const updateVanityMintResponse = await fetch('/api/token-mint/update-vanity-mint', {
        method: 'PATCH',
        body: JSON.stringify({
            keypairId: vanityId,
            status: 'reserved',
        }),
    })

    if (!updateVanityMintResponse.ok) {
        setStep('updateVanityMint', 'error')
        return { ok: false, error: 'Error updating vanity mint' }
    }
    setStep('updateVanityMint', 'success')

    return { ok: true }
}
