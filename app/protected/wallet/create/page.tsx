import CreateHub from '@/components/wallet/create/create-hub'

export default function Page() {
    return (
        <div className="flex-1 w-full flex flex-col gap-6 p-4">
            <div>
                <h1 className="text-lg font-semibold">Create Wallets</h1>
                <p className="text-xs text-muted-foreground mt-0.5">Choose a creation mode to get started</p>
            </div>
            <CreateHub />
        </div>
    )
}
