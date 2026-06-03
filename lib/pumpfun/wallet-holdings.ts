import { PublicKey, ParsedAccountData } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

import { initializeQuickNodeSolana } from "@/app/api/utils/helpers";
import { TokenHoldings } from '@/lib/types/token-holdings'


const quicknodeSolana = initializeQuickNodeSolana();

export async function getWalletHoldings(walletAddress: PublicKey) {
  try {
    const [v1, v2] = await Promise.all([
      quicknodeSolana.connection.getParsedTokenAccountsByOwner(walletAddress, { programId: TOKEN_PROGRAM_ID }),
      quicknodeSolana.connection.getParsedTokenAccountsByOwner(walletAddress, { programId: TOKEN_2022_PROGRAM_ID }),
    ]);

    const tokenHoldingsList: TokenHoldings[] = [];

    for (const { account } of [...v1.value, ...v2.value]) {
      const parsedData = account.data as ParsedAccountData;
      const info = parsedData.parsed.info;
      const mint: string = info.mint;
      const balance: number = info.tokenAmount.uiAmount ?? 0;

      tokenHoldingsList.push({ mint, balance });
    }

    return tokenHoldingsList;
  } catch {
    return null;
  }
}
