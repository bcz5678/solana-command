import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import TransferForm from './transfer-form';

export default function TransferCard() {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center space-y-0">
                <CardTitle className="text-sm font-medium">Transfer</CardTitle>
            </CardHeader>
            <CardContent>
                <TransferForm />
            </CardContent>
        </Card>
    );
}
