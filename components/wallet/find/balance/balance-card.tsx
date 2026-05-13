import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';
import Balance, { BalanceProps } from "./balance";

export default function BalanceCard({ walletAddress }: BalanceProps) {
    return (
    <>
        <Card>
            <CardHeader>
                <span className="hidden sm:inline">{walletAddress}</span>
                <span className="sm:hidden">{abbreviateAddress(walletAddress)}</span>
            </CardHeader>
            <CardContent>
                <Balance walletAddress={walletAddress} />
            </CardContent>
        </Card>
    </>
    );
};


function abbreviateAddress(address: string, startLength = 4, endLength = 4) {
    if (address.length <= startLength + endLength) {
        return address; // Return the original address if it's too short to abbreviate
    }
    return `${address.slice(0, startLength)}...${address.slice(-endLength)}`;
}