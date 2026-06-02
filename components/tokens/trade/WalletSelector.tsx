'use client'

import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { WalletRecord } from '@/lib/types/wallet'
import { lamportsBNToSolDisplay } from '@/lib/lamports'

interface WalletSelectorProps {
  wallets:  WalletRecord[]
  loading:  boolean
  selected: WalletRecord | null
  onSelect: (wallet: WalletRecord) => void
}

export function WalletSelector({ wallets, loading, selected, onSelect }: WalletSelectorProps) {
  const activeWallets = wallets.filter(w => w.is_active)

  const walletGroups: [string, WalletRecord[]][] = Object.entries(
    activeWallets.reduce<Record<string, WalletRecord[]>>((acc, w) => {
      const key = w.wallet_type ?? 'Other'
      ;(acc[key] ??= []).push(w)
      return acc
    }, {})
  )

  return (
    <DropdownMenu>

      {/* ── Trigger ──────────────────────────────────────────── */}
      <DropdownMenuTrigger
        disabled={loading}
        className={cn(
          'group w-full flex items-center gap-2.5 text-left rounded-lg border px-3 py-2.5',
          'bg-background border-input text-foreground',
          'enabled:hover:border-primary/40',
          'data-[state=open]:border-primary/40 data-[state=open]:ring-1 data-[state=open]:ring-primary/20',
          'transition-colors duration-150 cursor-pointer',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'focus-visible:outline-none'
        )}
      >
        {loading ? (
          <>
            <span className="size-3 shrink-0 rounded-full border-2 border-border border-t-primary animate-spin" />
            <span className="text-sm text-muted-foreground">Loading wallets…</span>
          </>
        ) : selected ? (
          <>
            <WalletDot active />
            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground truncate">
                {getWalletLabel(selected)}
              </span>
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-muted-foreground">
                  {formatPubkey(selected.public_key)}
                </span>
                <span className="font-mono text-xs font-semibold text-primary">
                  {formatBalance(selected)}
                </span>
              </div>
            </div>
            <Chevron />
          </>
        ) : (
          <>
            <WalletDot />
            <span className="text-sm text-muted-foreground">Select trading wallet…</span>
            <Chevron className="ml-auto" />
          </>
        )}
      </DropdownMenuTrigger>

      {/* ── Dropdown ─────────────────────────────────────────── */}
      <DropdownMenuContent className="p-0 rounded-xl shadow-lg">
        {walletGroups.length === 0 ? (
          <div className="px-5 py-5 text-center text-sm text-muted-foreground">
            No wallets available
          </div>
        ) : (
          walletGroups.map(([typeName, group], i) => (
            <div key={typeName}>
              {i > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="px-4 py-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                {typeName}
              </DropdownMenuLabel>
              {group.map(w => {
                const isEmpty = w.solana_balance_in_lamports == null || w.solana_balance_in_lamports.isZero()
                return (
                  <DropdownMenuItem
                    key={w.id}
                    disabled={isEmpty}
                    onSelect={() => onSelect(w)}
                    className={cn(
                      'flex items-center justify-between gap-3.5 px-4 py-3 rounded-none cursor-pointer',
                      'border-b border-border/50 last:border-b-0',
                      selected?.id === w.id && 'bg-primary/5',
                      isEmpty && 'opacity-40 cursor-not-allowed'
                    )}
                  >
                    {/* left: dot + label + pubkey */}
                    <div className="flex items-center gap-2.5 min-w-0">
                      <WalletDot active={selected?.id === w.id} />
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="text-sm font-medium text-foreground truncate">
                          {getWalletLabel(w)}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {formatPubkey(w.public_key)}
                        </span>
                      </div>
                    </div>

                    {/* right: SOL balance */}
                    <span className={cn(
                      'font-mono text-sm font-semibold shrink-0',
                      isEmpty ? 'text-muted-foreground' : 'text-primary'
                    )}>
                      {formatBalance(w)}
                    </span>
                  </DropdownMenuItem>
                )
              })}
            </div>
          ))
        )}
      </DropdownMenuContent>

    </DropdownMenu>
  )
}

// ── Helpers ────────────────────────────────────────────────────

function formatBalance(w: WalletRecord): string {
  if (w.solana_balance_in_lamports == null) return '—'
  return `${lamportsBNToSolDisplay(w.solana_balance_in_lamports)} SOL`
}

function formatPubkey(key: string): string {
  return `${key.slice(0, 7)}...${key.slice(-7)}`
}

function getWalletLabel(w: WalletRecord): string {
  return w.label ?? formatPubkey(w.public_key)
}

function WalletDot({ active = false }: { active?: boolean }) {
  return (
    <span
      className={cn(
        'size-1.75 rounded-full shrink-0 transition-colors duration-200',
        active ? 'bg-primary' : 'bg-border'
      )}
    />
  )
}

function Chevron({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'text-[0.55rem] text-muted-foreground shrink-0 ml-auto',
        'transition-transform duration-200 group-data-[state=open]:rotate-180',
        className
      )}
    >
      ▼
    </span>
  )
}
