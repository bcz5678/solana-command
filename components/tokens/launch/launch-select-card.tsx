import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { LaunchTypeParams } from '@/components/tokens/launch/types';

type Props = LaunchTypeParams & { isSelected?: boolean }

export default function LaunchSelectCard({ title, description, isSelected }: Props) {
    return (
        <Card className={[
            'h-full transition-colors',
            isSelected
                ? 'border-blue-500 bg-blue-500/5'
                : 'hover:border-blue-400/60',
        ].join(' ')}>
            <CardHeader>
                <CardTitle>{title}</CardTitle>
            </CardHeader>
            <CardContent>
                <p className="text-sm text-muted-foreground">{description}</p>
            </CardContent>
        </Card>
    );
}
