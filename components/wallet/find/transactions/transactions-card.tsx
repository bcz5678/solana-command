import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { TransactionsTable, TransactionProps } from "./transactions-table";

export default function TransactionCard({ walletAddress }: TransactionProps) {
  return (<>
    <Card>
      <CardHeader className="flex flex-row items-center space-y-0">
        <CardTitle className="text-sm font-medium">Transaction History</CardTitle>
      </CardHeader>
      <CardContent>
        <TransactionsTable walletAddress={walletAddress} />
      </CardContent>
    </Card>
    </>
  );
};