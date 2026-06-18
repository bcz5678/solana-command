'use client'

import { useState } from 'react'
import CloneTokenForm from '@/components/tokens/clone/clone-token-form'
import { CreateTokenFormInput } from '@/components/tokens/create/create-token-form'
import CreateTokenProgressDialog, {
    INITIAL_STEPS,
    TokenCreationSteps,
    StepStatus,
} from '@/components/tokens/create/create-token-progress-dialog'

import { submitCreateToken } from '@/lib/tokens/submit-create-token'

export default function Page() {
    const [dialogOpen, setDialogOpen] = useState(false)
    const [steps, setSteps] = useState<TokenCreationSteps>(INITIAL_STEPS)
    const [errorMessage, setErrorMessage] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)

    function setStep(key: keyof TokenCreationSteps, status: StepStatus) {
        setSteps(prev => ({ ...prev, [key]: status }))
    }

    const onSubmit = async (data: CreateTokenFormInput, logoFile: File, bannerFile: File | null) => {
        setSteps(INITIAL_STEPS)
        setErrorMessage('')
        setIsSubmitting(true)
        setDialogOpen(true)

        const result = await submitCreateToken(data, logoFile, bannerFile, setStep)

        if (!result.ok) {
            setErrorMessage(result.error ?? 'Unknown error')
        }
        setIsSubmitting(false)
    }

    return (
        <div className="flex-1 w-full flex flex-col gap-6 p-4">
            <h1 className="text-2xl font-bold text-black">Clone Token</h1>
            <CloneTokenForm onSubmit={onSubmit} isSubmitting={isSubmitting} />
            <CreateTokenProgressDialog
                open={dialogOpen}
                steps={steps}
                errorMessage={errorMessage}
                onClose={() => setDialogOpen(false)}
            />
        </div>
    )
}
