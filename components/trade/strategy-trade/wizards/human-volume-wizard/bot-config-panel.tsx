'use client'

import { Input } from '@/components/ui/input'

export interface BotConfigState {
    buyAmountMinSol:  string
    buyAmountMaxSol:  string
    sellPercentMin:   string
    sellPercentMax:   string
    jitoTipSol:       string
    totalCycles:      string
    minHoldCycles:    string
    maxHoldCycles:    string
    cycleIntervalMs:  string
    cycleJitterMs:    string
    minWalletSol:     string
    txFeeBufferSol:   string
    maxSellTranches:  string
    buysPerCycleMin:  string
    buysPerCycleMax:  string
}

export const DEFAULT_BOT_CONFIG: BotConfigState = {
    buyAmountMinSol:  '0.01',
    buyAmountMaxSol:  '0.025',
    sellPercentMin:   '60',
    sellPercentMax:   '100',
    jitoTipSol:       '0.001',
    totalCycles:      '1000000',
    minHoldCycles:    '2',
    maxHoldCycles:    '8',
    cycleIntervalMs:  '6000',
    cycleJitterMs:    '2000',
    minWalletSol:     '0.02',
    txFeeBufferSol:   '0.000005',
    maxSellTranches:  '2',
    buysPerCycleMin:  '1',
    buysPerCycleMax:  '3',
}

type Props = {
    config:    BotConfigState
    onChange:  (key: keyof BotConfigState, value: string) => void
    disabled?: boolean
}

function Field({
    label, suffix, id, value, onChange, disabled,
}: {
    label:     string
    suffix?:   string
    id:        keyof BotConfigState
    value:     string
    onChange:  (key: keyof BotConfigState, val: string) => void
    disabled?: boolean
}) {
    return (
        <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider truncate">
                {label}
            </label>
            <div className="relative flex items-center">
                <Input
                    value={value}
                    onChange={e => onChange(id, e.target.value)}
                    disabled={disabled}
                    className="h-9 text-xs font-mono pr-10"
                />
                {suffix && (
                    <span className="absolute right-3 text-xs text-muted-foreground pointer-events-none select-none">
                        {suffix}
                    </span>
                )}
            </div>
        </div>
    )
}

export default function BotConfigPanel({ config, onChange, disabled }: Props) {
    return (
        <div className="flex flex-col gap-3">

            <div className="grid grid-cols-4 gap-3">
                <Field label="Buy Amount Min"  suffix="SOL" id="buyAmountMinSol" value={config.buyAmountMinSol} onChange={onChange} disabled={disabled} />
                <Field label="Buy Amount Max"  suffix="SOL" id="buyAmountMaxSol" value={config.buyAmountMaxSol} onChange={onChange} disabled={disabled} />
                <Field label="Sell Percent Min" suffix="%"  id="sellPercentMin"  value={config.sellPercentMin}  onChange={onChange} disabled={disabled} />
                <Field label="Sell Percent Max" suffix="%"  id="sellPercentMax"  value={config.sellPercentMax}  onChange={onChange} disabled={disabled} />
            </div>

            <div className="grid grid-cols-4 gap-3">
                <Field label="Hold Cycles Min"  suffix="cyc" id="minHoldCycles"   value={config.minHoldCycles}   onChange={onChange} disabled={disabled} />
                <Field label="Hold Cycles Max"  suffix="cyc" id="maxHoldCycles"   value={config.maxHoldCycles}   onChange={onChange} disabled={disabled} />
                <Field label="Trade Interval"   suffix="ms"  id="cycleIntervalMs" value={config.cycleIntervalMs} onChange={onChange} disabled={disabled} />
                <Field label="Interval Jitter ±" suffix="ms" id="cycleJitterMs"   value={config.cycleJitterMs}   onChange={onChange} disabled={disabled} />
            </div>

            <div className="grid grid-cols-4 gap-3">
                <Field label="Jito Tip"              suffix="SOL" id="jitoTipSol"      value={config.jitoTipSol}      onChange={onChange} disabled={disabled} />
                <Field label="Tranches"                           id="maxSellTranches"  value={config.maxSellTranches} onChange={onChange} disabled={disabled} />
                <Field label="Min Wallet Before Buy" suffix="SOL" id="minWalletSol"    value={config.minWalletSol}    onChange={onChange} disabled={disabled} />
                <Field label="Fee Buffer"            suffix="SOL" id="txFeeBufferSol"  value={config.txFeeBufferSol}  onChange={onChange} disabled={disabled} />
            </div>

            <div className="grid grid-cols-4 gap-3">
                <Field label="Cycle # Buys Min" suffix="×"   id="buysPerCycleMin" value={config.buysPerCycleMin} onChange={onChange} disabled={disabled} />
                <Field label="Cycle # Buys Max" suffix="×"   id="buysPerCycleMax" value={config.buysPerCycleMax} onChange={onChange} disabled={disabled} />
                <Field label="Total Cycles"     suffix="cyc" id="totalCycles"     value={config.totalCycles}     onChange={onChange} disabled={disabled} />
            </div>

        </div>
    )
}
