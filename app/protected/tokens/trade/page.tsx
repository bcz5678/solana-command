'use client'

import { useState, useEffect } from 'react'; 
import TokenSearch from '@/components/tokens/trade/search/token-search'

export default function Page() {
  const [ tokenPair, setTokenPair ] = useState<string | null>(null);
    
  const updateFromSearch = (data: string) => {
    setTokenPair(data);
  }

  return (
    <div className="flex-1 w-full flex flex-col gap-6 p-4">
      <h1 className="text-2xl font-bold text-black">Buy/Sell Tokens</h1>
      <TokenSearch onSearchSubmit={updateFromSearch}/>
      { tokenPair != null ? 
        (`${tokenPair}`) :  ''

      }

    </div>
  )



}