
import {
    Connection, 
    AddressLookupTableProgram, 
    Keypair,
    PublicKey, 
    Transaction,
    TransactionMessage, 
    VersionedTransaction 
} from '@solana/web3.js';

export async function createLookupTable(
    connection: Connection, 
    payer: Keypair
) : Promise<[string, PublicKey]> {
    // 3. Get the current slot required to create the table
    const slot = await connection.getSlot();

    // 4. Generate the lookup table creation instruction and its address
    const [lookupTableInstruction, lookupTableAddress] = 
        AddressLookupTableProgram.createLookupTable({
            authority: payer.publicKey,
            payer: payer.publicKey,
            recentSlot: slot,
        });

    console.log("Lookup Table Address:", lookupTableAddress.toBase58());

    // 5. Create and sign the transaction
    const transaction = new Transaction().add(lookupTableInstruction);
    transaction.feePayer = payer.publicKey;
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    // 6. Sign and send the transaction
    const signature = await connection.sendTransaction(transaction, [payer]);
    console.log("Transaction Signature:", signature);

    return [signature, lookupTableAddress];
}

/**
 * Extends an Address Lookup Table with up to 20 addresses.
 * @param connection - The QuickNode Connection instance
 * @param payer - The Keypair paying for the transaction and holding ALT authority
 * @param lookupTableAddress - The PublicKey of the created ALT
 * @param addressesToInclude - Array of up to 20 PublicKeys to add
 */
export async function extendLookupTable(
    connection: Connection,
    payer: Keypair,
    lookupTableAddress: PublicKey,
    addressesToInclude: PublicKey[]
): Promise<string> {
    if (addressesToInclude.length > 20) {
        throw new Error("This function is optimized for up to 20 addresses.");
    }

    // 1. Create the extend instruction
    const extendInstruction = AddressLookupTableProgram.extendLookupTable({
        payer: payer.publicKey,
        authority: payer.publicKey,
        lookupTable: lookupTableAddress,
        addresses: addressesToInclude,
    });

    // 2. Fetch the latest blockhash
    const { blockhash } = await connection.getLatestBlockhash();

    // 3. Compile the message into a Versioned Transaction (recommended for ALTs)
    const messageV0 = new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: blockhash,
        instructions: [extendInstruction],
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);

    // 4. Sign the transaction
    transaction.sign([payer]);

    // 5. Send the transaction via your QuickNode RPC
    const signature = await connection.sendTransaction(transaction);
    console.log(`Extension Transaction Signature: ${signature}`);
    
    // 6. Wait for activation (ALTs require 1 slot cooldown before they can be used)
    console.log("Waiting for lookup table to activate slot... (usually 1-2 seconds)");
    return signature;
}