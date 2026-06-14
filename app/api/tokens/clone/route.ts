import { Connection, PublicKey } from '@solana/web3.js';
import { handleError, initializeQuickNodeSolana, parseAndValidateAddress } from '@/app/api/utils/helpers';
import { getTokenMetadata, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';


const PUMP_AMM_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');

// Pump AMM pool account layout (Anchor discriminator prefix):
// [0-7]   discriminator (8)
// [8]     pool_bump (1)
// [9-10]  index u16 (2)
// [11-42] creator Pubkey (32)
// [43-74] base_mint Pubkey (32)  <-- the actual token mint
const PUMP_AMM_BASE_MINT_OFFSET = 43;

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const url = new URL(request.url);
    const mintAddressParam = url.searchParams.get('mintAddress');
    try {
        const connection: Connection = initializeQuickNodeSolana().connection;
      
        const mintPublicKey = await parseAndValidateAddress(mintAddressParam!.trim());

        const accountInfo = await connection.getAccountInfo(mintPublicKey);
        if (!accountInfo) {
            throw new Error('Mint account not found');
        }

        console.log(`clone-token -> accountInfo.owner:${accountInfo.owner}`);

        // If the address is a Pump AMM pool, extract the actual base_mint from the pool data
        let resolvedMint = mintPublicKey;
        let resolvedAccountInfo = accountInfo;

        if (accountInfo.owner.equals(PUMP_AMM_PROGRAM_ID)) {
            const baseMintBytes = accountInfo.data.subarray(PUMP_AMM_BASE_MINT_OFFSET, PUMP_AMM_BASE_MINT_OFFSET + 32);
            resolvedMint = new PublicKey(baseMintBytes);
            console.log(`clone-token -> pool detected, resolved base_mint:${resolvedMint.toBase58()}`);
            const mintInfo = await connection.getAccountInfo(resolvedMint);
            if (!mintInfo) throw new Error(`Base mint account not found: ${resolvedMint.toBase58()}`);
            resolvedAccountInfo = mintInfo;
        }

        const programId = resolvedAccountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
            ? TOKEN_2022_PROGRAM_ID
            : TOKEN_PROGRAM_ID;

        console.log(`clone-token -> programId:${programId}`);

        let metaData;
        try {
            metaData = await getTokenMetadata(
                connection,
                resolvedMint,
                undefined,
                programId,
            );
            console.log(`clone-token -> metadata:`, JSON.stringify(metaData, null, 2));
        } catch (metaErr) {
            console.error(`clone-token -> getTokenMetadata failed | mint:${resolvedMint.toBase58()} | programId:${programId.toBase58()} | owner:${resolvedAccountInfo.owner.toBase58()} | error:`, metaErr);
            throw metaErr;
        }

        let uriData: unknown = null;
        if (metaData?.uri) {
            const uriRes = await fetch(metaData.uri);
            if (!uriRes.ok) throw new Error(`Failed to fetch URI: ${uriRes.status} ${metaData.uri}`);
            uriData = await uriRes.json();
            console.log(`clone-token -> uriData:`, JSON.stringify(uriData, null, 2));
        }

        return new Response(JSON.stringify({ metaData, uriData }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
        });
    } catch (error) {
        return handleError(error);
    }
}