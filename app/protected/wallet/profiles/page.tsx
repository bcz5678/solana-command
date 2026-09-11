import WalletProfileManager from '@/components/wallet/profiles/wallet-profile-manager'

export default function WalletProfilesPage() {
    return (
        <div className="flex-1 w-full flex flex-col gap-6 p-4">
            <div>
                <h1 className="text-2xl font-bold">Wallet Profiles</h1>
                <p className="text-sm text-muted-foreground">
                    Give a trading wallet a real-looking, warmed-up Pump.fun identity — username, bio, avatar, and setup status.
                </p>
            </div>
            <WalletProfileManager />
        </div>
    )
}
