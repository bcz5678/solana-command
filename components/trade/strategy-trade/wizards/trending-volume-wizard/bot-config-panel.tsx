'use client'

import { Input } from '@/components/ui/input'

export interface BotConfigState {
    solAmountMinSol:     string
    solAmountMaxSol:     string
    jitoTipSol:          string
    slippagePct:         string
    totalRounds:         string
    roundIntervalMs:     string
    roundJitterMs:       string
    walletsPerRoundMin:  string
    walletsPerRoundMax:  string
    minWalletSol:        string
    txFeeBufferSol:      string
}

export const DEFAULT_BOT_CONFIG: BotConfigState = {
    solAmountMinSol:     '0.01',
    solAmountMaxSol:     '0.025',
    jitoTipSol:          '0.0005',
    slippagePct:         '10',
    totalRounds:         '1000000',
    roundIntervalMs:     '8000',
    roundJitterMs:       '3000',
    walletsPerRoundMin:  '1',
    walletsPerRoundMax:  '3',
    minWalletSol:        '0.02',
    txFeeBufferSol:      '0.000005',
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
                <Field label="Trade Amount Min" suffix="SOL" id="solAmountMinSol" value={config.solAmountMinSol} onChange={onChange} disabled={disabled} />
                <Field label="Trade Amount Max" suffix="SOL" id="solAmountMaxSol" value={config.solAmountMaxSol} onChange={onChange} disabled={disabled} />
                <Field label="Slippage"         suffix="%"   id="slippagePct"     value={config.slippagePct}     onChange={onChange} disabled={disabled} />
                <Field label="Jito Tip"         suffix="SOL" id="jitoTipSol"      value={config.jitoTipSol}      onChange={onChange} disabled={disabled} />
            </div>

            <div className="grid grid-cols-4 gap-3">
                <Field label="Round Interval"    suffix="ms" id="roundIntervalMs"    value={config.roundIntervalMs}    onChange={onChange} disabled={disabled} />
                <Field label="Interval Jitter ±" suffix="ms" id="roundJitterMs"      value={config.roundJitterMs}      onChange={onChange} disabled={disabled} />
                <Field label="Wallets/Round Min" suffix="×"  id="walletsPerRoundMin" value={config.walletsPerRoundMin} onChange={onChange} disabled={disabled} />
                <Field label="Wallets/Round Max" suffix="×"  id="walletsPerRoundMax" value={config.walletsPerRoundMax} onChange={onChange} disabled={disabled} />
            </div>

            <div className="grid grid-cols-4 gap-3">
                <Field label="Min Wallet Before Trade" suffix="SOL" id="minWalletSol"   value={config.minWalletSol}   onChange={onChange} disabled={disabled} />
                <Field label="Fee Buffer"              suffix="SOL" id="txFeeBufferSol" value={config.txFeeBufferSol} onChange={onChange} disabled={disabled} />
                <Field label="Total Rounds"            suffix="rd"  id="totalRounds"    value={config.totalRounds}    onChange={onChange} disabled={disabled} />
            </div>

        </div>
    )
}
