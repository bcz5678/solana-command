import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import TokenTable, { TokenProps } from "./token-table";


export default function TokenCard({ walletAddress }: TokenProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center space-y-0">
        <CardTitle className="text-sm font-medium">Tokens</CardTitle>
      </CardHeader>
      <CardContent>
        <TokenTable walletAddress={walletAddress} />
      </CardContent>
    </Card>
  );
};
