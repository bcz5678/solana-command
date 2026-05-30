'use client'

import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { WalletRecord } from '@/lib/types/wallet'

interface WalletSelectorProps {
  wallets:  WalletRecord[]
  loading:  boolean
  selected: WalletRecord | null
  onSelect: (wallet: WalletRecord) => void
}

export function WalletSelector({ wallets, loading, selected, onSelect }: WalletSelectorProps) {
  const activeWallets = wallets.filter(w => w.is_active)

  return (
    <DropdownMenu>

      {/* ── Trigger ──────────────────────────────────────────── */}
      <DropdownMenuTrigger
        disabled={loading}
        className={cn(
          'group w-full flex items-center gap-2.5 text-left rounded-[10px] border px-4 py-3.5',
          'bg-white/3 border-white/8 text-[#c8d4e0]',
          'enabled:hover:border-[#00ff88]/20 enabled:hover:bg-[#00ff88]/3',
          'data-[state=open]:border-[#00ff88]/20 data-[state=open]:bg-[#00ff88]/3',
          'transition-colors duration-200 cursor-pointer',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'focus-visible:outline-none'
        )}
      >
        {loading ? (
          <>
            <span className="size-3 shrink-0 rounded-full border-2 border-[#00ff88]/15 border-t-[#00ff88] animate-spin" />
            <span className="font-mono text-[0.7rem] text-[#3a5060]">Loading wallets...</span>
          </>
        ) : selected ? (
          <>
            <WalletDot active />
            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
              <span className="text-sm font-semibold text-[#e8f0f8] truncate">
                {getWalletLabel(selected)}
              </span>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[0.62rem] text-[#3a5060]">
                  {formatPubkey(selected.public_key)}
                </span>
                <span className="font-mono text-[0.62rem] text-[#00cc70]">
                  {formatBalance(selected)}
                </span>
              </div>
            </div>
            <Chevron />
          </>
        ) : (
          <>
            <WalletDot />
            <span className="text-[0.82rem] text-[#2a4050]">Select trading wallet...</span>
            <Chevron className="ml-auto" />
          </>
        )}
      </DropdownMenuTrigger>

      {/* ── Dropdown ─────────────────────────────────────────── */}
      <DropdownMenuContent
        className={cn(
          'p-0 rounded-xl bg-[#0d1520] border-white/10',
          'shadow-[0_16px_48px_rgba(0,0,0,0.6)]'
        )}
      >
        {activeWallets.length === 0 ? (
          <div className="px-5 py-5 text-center font-mono text-[0.7rem] text-[#3a5060]">
            No wallets available
          </div>
        ) : (
          activeWallets.map(w => (
            <DropdownMenuItem
              key={w.id}
              onSelect={() => onSelect(w)}
              className={cn(
                'flex items-center justify-between gap-3.5 px-4 py-3.5 rounded-none cursor-pointer',
                'border-b border-white/4 last:border-b-0',
                'focus:bg-white/4 focus:text-[#c8d4e0]',
                selected?.id === w.id && 'bg-[#00ff88]/5'
              )}
            >
              {/* left: dot + name + key */}
              <div className="flex items-center gap-2.5 min-w-0">
                <WalletDot active={selected?.id === w.id} />
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[0.82rem] font-semibold text-[#e8f0f8] truncate">
                    {getWalletLabel(w)}
                  </span>
                  <span className="font-mono text-[0.6rem] text-[#3a5060]">
                    {formatPubkey(w.public_key)}
                  </span>
                </div>
              </div>

              {/* right: balance + wallet type */}
              <div className="flex flex-col items-end gap-0.5 shrink-0">
                <span className="font-mono text-[0.72rem] font-bold text-[#00cc70]">
                  {formatBalance(w)}
                </span>
                {w.wallet_type && (
                  <span className="font-mono text-[0.55rem] tracking-[0.08em] uppercase text-[#2a4050]">
                    {w.wallet_type}
                  </span>
                )}
              </div>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>

    </DropdownMenu>
  )
}

// ── Helpers ────────────────────────────────────────────────────

function formatBalance(w: WalletRecord): string {
  if (w.solana_balance_in_lamports == null) return '—'
  const sol = w.solana_balance_in_lamports.toNumber() / 1_000_000_000
  return `${sol.toFixed(4)} SOL`
}

function formatPubkey(key: string): string {
  return `${key.slice(0, 6)}...${key.slice(-6)}`
}

function getWalletLabel(w: WalletRecord): string {
  return w.label ?? formatPubkey(w.public_key)
}

function WalletDot({ active = false }: { active?: boolean }) {
  return (
    <span
      className={cn(
        'size-1.75 rounded-full shrink-0 transition-colors duration-200',
        active
          ? 'bg-[#00ff88] shadow-[0_0_6px_rgba(0,255,136,0.5)]'
          : 'bg-[#2a3a40]'
      )}
    />
  )
}

function Chevron({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'text-[0.55rem] text-[#3a5060] shrink-0 ml-auto',
        'transition-transform duration-200',
        'group-data-[state=open]:rotate-180',
        className
      )}
    >
      ▼
    </span>
  )
}
