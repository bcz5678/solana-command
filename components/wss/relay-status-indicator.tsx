'use client'

import { useRelayStatus, type RelayConnectionStatus } from '@/hooks/use-relay-event'
import { useSidebar } from '@/components/ui/sidebar'

const STATUS_DOT: Record<RelayConnectionStatus, string> = {
    connecting: 'bg-amber-500 animate-pulse',
    open:       'bg-emerald-500',
    closed:     'bg-red-500',
}

const STATUS_LABEL: Record<RelayConnectionStatus, string> = {
    connecting: 'Connecting…',
    open:       'Connected',
    closed:     'Disconnected',
}

export function RelayStatusIndicator() {
    const status = useRelayStatus()
    const { state } = useSidebar()

    return (
        <div className="flex items-center gap-2">
            <span className={`inline-block size-2 rounded-full ${STATUS_DOT[status]}`} />
            {state !== 'collapsed' && (
                <span className="text-sm font-medium">{STATUS_LABEL[status]}</span>
            )}
        </div>
    )
}
