import TradeRunTable from '@/components/trade/control-center/trade-run-table'
import BotStatusSection from '@/components/trade/control-center/bot-status-section'

export default function ControlCenterPage() {
    return (
        <div className="flex flex-col gap-6 p-6 w-full min-h-0">
            <div className="flex flex-col gap-1">
                <h2 className="text-sm font-semibold">Trade Control Center</h2>
                <p className="text-xs text-muted-foreground">
                    Every staggered, bundle, and launch-builder run — live from the durable record each one writes as it
                    progresses. Pause/Resume/Cancel only take effect while the tab that started a run is still open and polling.
                </p>
            </div>
            <BotStatusSection />
            <TradeRunTable />
        </div>
    )
}
