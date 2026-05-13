'use client'

import  CreateWalletsForm  from '@/components/wallet/create/create-wallets-form'

export default function Page() {
  return (
    <div className="flex-1 w-full flex flex-col gap-6 p-4">
      <h1 className="text-2xl font-bold text-black">Create Wallets</h1>
      <CreateWalletsForm />
    </div>
  );
}
