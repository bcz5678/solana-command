import { Keypair } from '@solana/web3.js';
import { createClient } from '@/lib/supabase/client';
import * as fs from 'fs';
import path from 'path';
import bs58 from 'bs58';

import BN from 'bn.js';

import { 
  WalletModelDTO,
 } from '@/app/db/models/wallet';

const supabase = createClient();

export interface CreateWalletParams {
  numOfWallets: number,
  walletTypeId: number,
  groupID: number,
  ownerID: number, 
}


export async function generateWallets(
  params: CreateWalletParams
): Promise<{ count: number } | { error: string }> {
  const wallets: WalletModelDTO[] = [];
  for (let i = 0; i < params.numOfWallets; i++) {
    const newKeyPair = Keypair.generate();
    wallets.push({
      public_key: newKeyPair.publicKey.toString(),
      secret_key: bs58.encode(newKeyPair.secretKey),
      funded: false,
      wallet_type_id: params.walletTypeId,
      solana_balance_in_lamports: new BN(0),
      owner_id: params.ownerID,
      group_id: params.groupID,
      token_holdings: [],
    });
  }

  const { data, error } = await supabase
    .from('wallets')
    .insert(wallets)
    .select();

  if (error) {
    return { error: error.message };
  }
  return { count: data.length };
}



