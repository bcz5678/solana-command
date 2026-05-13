'use-client'

import AddExistingWalletForm  from '@/components/wallet/add-existing/add-existing-wallet-form'

export default function Page() {
    return (
        <div className="flex-1 w-full flex flex-col gap-6 p-4">                
            <h1 className="text-2xl text-black font-bold">Add an Existing Wallet</h1>
            <AddExistingWalletForm />
        </div>
    ); 
}