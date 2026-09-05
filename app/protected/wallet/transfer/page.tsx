import TransferHub from "@/components/wallet/transfer/transfer-hub";

export default function Page() {
    return (
        <div className="flex-1 w-full flex flex-col gap-6 p-4">
            <div>
                <h1 className="text-lg font-semibold">Transfer</h1>
                <p className="text-xs text-muted-foreground mt-0.5">Choose a transfer mode to get started</p>
            </div>
            <TransferHub />
        </div>
    );
}