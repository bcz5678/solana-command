
'use client'

import { useState, useEffect } from 'react';

import WalletSearch from "@/components/wallet/find/header/wallet-search"
import BalanceCard from '@/components/wallet/find/balance/balance-card';
import TokenCard from '@/components/wallet/find/tokens/token-card';
import TransactionCard from '@/components/wallet/find/transactions/transactions-card';


export default function Page() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  const updateFromSearch = (data: string) => {
    setWalletAddress(data);
  }

  return (
    <div className="flex flex-col w-full min-h-screen p-4 md:p-10 space-y-4 justify-start">
      <WalletSearch onSearchSubmit={updateFromSearch}/>
      { walletAddress != null ? (
        <>
          <BalanceCard walletAddress={walletAddress} />
          <TokenCard walletAddress={walletAddress} />
          <TransactionCard walletAddress={walletAddress} />
        </>
        ): null
      }
    </div>
  )
}