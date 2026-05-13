import TransferCard from "@/components/wallet/transfer/transfer-card";

export default function Page() {
    return (
        <div className="flex-1 w-full flex flex-col gap-6 p-4">
            <h1 className="text-2xl font-bold text-black">Transfer Solana</h1>
            <TransferCard />
        </div>
    );
}