'use client'

import CreateTokenForm from '@/components/tokens/create/create-token-form'

export default function Page() {
  return (
    <div className="flex-1 w-full flex flex-col gap-6 p-4">
      <h1 className="text-2xl font-bold text-black">Create Token</h1>
      <CreateTokenForm />
    </div>
  );
}
