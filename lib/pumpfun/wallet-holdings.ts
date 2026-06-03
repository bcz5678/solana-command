import { PublicKey, ParsedAccountData } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { OnlinePumpSdk } from "@nirholas/pump-sdk";

import { initializeQuickNodeSolana } from "@/app/api/utils/helpers";
import { TokenHoldings } from '@/lib/types/token-holdings' 

import BN from 'bn.js';


const quicknodeSolana = initializeQuickNodeSolana();
const onlineSdk = new OnlinePumpSdk(quicknodeSolana.connection);

export async function getWalletHoldings(walletAddress: PublicKey) {
  try {
    // 1. Fetch all SPL token accounts owned by the wallet (both classic and Token-2022)
    const [v1, v2] = await Promise.all([
      quicknodeSolana.connection.getParsedTokenAccountsByOwner(walletAddress, { programId: TOKEN_PROGRAM_ID }),
      quicknodeSolana.connection.getParsedTokenAccountsByOwner(walletAddress, { programId: TOKEN_2022_PROGRAM_ID }),
    ]);

    const tokenHoldingsList: TokenHoldings[] = [];

    // 2. Iterate through accounts and parse tokenMint address and balance
    for (const { account } of [...v1.value, ...v2.value]) {
      const parsedData = account.data as ParsedAccountData;
      const info = parsedData.parsed.info;
      const mint: string = info.mint;
      const balance: BN = new BN(info.tokenAmount.uiAmount) ??  new BN(0);

      tokenHoldingsList.push({ mint, balance });
    }

    return tokenHoldingsList;
  } catch {
    return null;
  }
}
