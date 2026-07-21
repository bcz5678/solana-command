import { Connection, PublicKey } from '@solana/web3.js';
import { handleError, initializeQuickNodeSolana, parseAndValidateAddress } from '@/app/api/utils/helpers';
import { getTokenMetadata, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';


const PUMP_AMM_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const MPL_TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

// Legacy Metaplex Token Metadata account layout (used by pump.fun and virtually
// all classic Token Program mints, as opposed to Token-2022's embedded metadata
// extension read by `getTokenMetadata` above): 1-byte key + updateAuthority(32)
// + mint(32), then borsh strings for name/symbol/uri, each right-padded with
// null bytes out to their legacy max length.
function readBorshString(data: Buffer, offset: number): [string, number] {
    const len = data.readUInt32LE(offset);
    const start = offset + 4;
    const value = data.subarray(start, start + len).toString('utf8').replace(/\0/g, '').trim();
    return [value, start + len];
}

async function getLegacyMetaplexMetadata(
    connection: Connection,
    mint: PublicKey,
): Promise<{ name: string; symbol: string; uri: string } | null> {
    const [metadataPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('metadata'), MPL_TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
        MPL_TOKEN_METADATA_PROGRAM_ID,
    );

    const accountInfo = await connection.getAccountInfo(metadataPda);
    if (!accountInfo) return null;

    let offset = 1 + 32 + 32; // key + updateAuthority + mint
    const [name, o1] = readBorshString(accountInfo.data, offset);
    const [symbol, o2] = readBorshString(accountInfo.data, o1);
    const [uri] = readBorshString(accountInfo.data, o2);
    return { name, symbol, uri };
}

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

        // Most mints (pump.fun included) don't use the Token-2022 metadata
        // extension above — they store name/symbol/uri in a separate legacy
        // Metaplex Token Metadata account instead. Fall back to that.
        if (!metaData) {
            metaData = await getLegacyMetaplexMetadata(connection, resolvedMint);
            console.log(`clone-token -> legacy metaplex metadata:`, JSON.stringify(metaData, null, 2));
        }

        if (!metaData) {
            throw new Error(`No on-chain metadata found for mint: ${resolvedMint.toBase58()}`);
        }

        // The off-chain JSON (description/socials/image) usually lives on a public
        // IPFS gateway, which is frequently slow or rate-limited. Don't let a flaky
        // fetch here throw away the on-chain name/symbol/uri we already resolved —
        // degrade to metaData-only instead of failing the whole lookup.
        let uriData: unknown = null;
        if (metaData?.uri) {
            try {
                const uriRes = await fetch(metaData.uri, { signal: AbortSignal.timeout(8000) });
                if (!uriRes.ok) throw new Error(`HTTP ${uriRes.status}`);
                uriData = await uriRes.json();
                console.log(`clone-token -> uriData:`, JSON.stringify(uriData, null, 2));
            } catch (uriErr) {
                console.error(`clone-token -> failed to fetch off-chain uri:${metaData.uri} | error:`, uriErr);
            }
        }

        return new Response(JSON.stringify({ metaData, uriData }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
        });
    } catch (error) {
        return handleError(error);
    }
}