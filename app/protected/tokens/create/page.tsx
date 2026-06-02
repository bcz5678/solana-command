'use client'

import { useState } from 'react'
import CreateTokenForm, { CreateTokenFormInput } from '@/components/tokens/create/create-token-form'
import CreateTokenProgressDialog, {
    INITIAL_STEPS,
    TokenCreationSteps,
    StepStatus,
} from '@/components/tokens/create/create-token-progress-dialog'

import { ClaimVanityResponse } from '@/lib/types/responses'

export default function Page() {
    const [dialogOpen, setDialogOpen] = useState(false)
    const [steps, setSteps] = useState<TokenCreationSteps>(INITIAL_STEPS)
    const [errorMessage, setErrorMessage] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)

    function setStep(key: keyof TokenCreationSteps, status: StepStatus) {
        setSteps(prev => ({ ...prev, [key]: status }))
    }

    const onSubmit = async (data: CreateTokenFormInput, logoFile: File) => {
        setSteps(INITIAL_STEPS)
        setErrorMessage('')
        setIsSubmitting(true)
        setDialogOpen(true)

        // Step 1 — Claim vanity mint
        setStep('claimVanityMint', 'loading')

        const vanityMintResponse = await fetch('/api/token/claim-vanity', { method: 'POST' })

        if (!vanityMintResponse.ok) {
            setStep('claimVanityMint', 'error')
            setErrorMessage('No vanity keypairs available.')
            setIsSubmitting(false)
            return
        }

        const { publicKey: contractAddress, keypairId: vanityId }: ClaimVanityResponse =
            await vanityMintResponse.json()

        setStep('claimVanityMint', 'success')


        // Step 2 — Upload token image
        setStep('uploadTokenImage', 'loading')

        const ext = logoFile.name.split('.').pop()

        // Rename by constructing a new File with the same bytes but a new name
        const renamedImage = new File(
            [logoFile],
            `${data.symbol}_${contractAddress.slice(0, 7)}_logo.${ext}`,
            { type: logoFile.type }
        )

        // Send as multipart/form-data so the API can read it with formData()
        const imageForm = new FormData()
        imageForm.append('image', renamedImage)

        const uploadImageResponse = await fetch('/api/token/upload-image', {
            method: 'POST',
            body: imageForm,   // do NOT set Content-Type — browser adds the boundary automatically
        })

        if (!uploadImageResponse.ok) {
            setStep('uploadTokenImage', 'error')
            setErrorMessage('Error uploading logo.')
            setIsSubmitting(false)
            return
        }
        const { url: imageUrl } = await uploadImageResponse.json()
        setStep('uploadTokenImage', 'success')

        // Step 3 — Upload token meta to AWS
        setStep('uploadTokenMeta', 'loading')

        const uploadMetaResponse = await fetch('/api/token/upload-meta', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filename: `${data.symbol}_${contractAddress.slice(0, 7)}_meta.json`,
                meta: {
                    name: data.name,
                    symbol: data.symbol,
                    description: data.description,
                    image: imageUrl,
                    websiteUrl: data.websiteUrl,
                    twitterUrl: data.twitterUrl,
                    telegramHandle: data.telegramHandle,
                    tiktokUrl: data.tiktokUrl,
                    instagramUrl: data.instagramUrl,
                    discordUrl: data.discordUrl,
                    communitiesUrl: data.communitiesUrl,
                },
            }),
        })

        if (!uploadMetaResponse.ok) {
            setStep('uploadTokenMeta', 'error')
            setErrorMessage('Error uploading token metadata.')
            setIsSubmitting(false)
            return
        }

        const { url: tokenMetaUrl } = await uploadMetaResponse.json()

        setStep('uploadTokenMeta', 'success')

        // Step 4 — Build token & store in DB
        setStep('saveToken', 'loading')

        const buildTokenResponse = await fetch('/api/token/build', {
            method: 'POST',
            body: JSON.stringify({
                keypairId: vanityId,
                devWalletId: data.creatorWallet,
                tokenName: data.name,
                tokenSymbol: data.symbol,
                description: data.description,
                logoUrl: imageUrl,
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
            setErrorMessage('Error building token.')
            setIsSubmitting(false)
            return
        }

        setStep('saveToken', 'success')

        // Step 6 — Update vanity mint
        setStep('updateVanityMint', 'loading')

        const updateVanityMintResponse = await fetch('/api/token/update-vanity-mint', {
          method: 'PATCH',
          body: JSON.stringify({
            keypairId: vanityId,
            status: "reserved",
          }),
        });

        if (!updateVanityMintResponse.ok) {
            setStep('updateVanityMint', 'error')
            setErrorMessage('Error updating vanity mint')
            setIsSubmitting(false)
            return
        }
        setStep('updateVanityMint', 'success')
        setIsSubmitting(false)
    }

    return (
        <div className="flex-1 w-full flex flex-col gap-6 p-4">
            <h1 className="text-2xl font-bold text-black">Create Token</h1>
            <CreateTokenForm onSubmit={onSubmit} isSubmitting={isSubmitting} />
            <CreateTokenProgressDialog
                open={dialogOpen}
                steps={steps}
                errorMessage={errorMessage}
                onClose={() => setDialogOpen(false)}
            />
        </div>
    )
}
