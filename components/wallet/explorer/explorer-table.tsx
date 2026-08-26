'use client'

import { useState, useMemo, useRef, useCallback } from 'react'
import BN from 'bn.js'
import { lamportsBNToSolDisplay, lamportsBNToSolNumber } from '@/lib/lamports';

import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Copy, ExternalLink } from 'lucide-react'
import { WalletRecord } from '@/lib/types/wallet';

type Token = { symbol: string; name: string }

type LookupEntry = { id: string; name: string }

type Props = {
  wallets: WalletRecord[]
  walletTypes: LookupEntry[]
  owners: LookupEntry[]
  groups: LookupEntry[]
  solUsdPrice?: number | null
}

const ALL = 'all'

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function formatUsd(lamports: BN, solUsdPrice: number | null | undefined): string | null {
  if (solUsdPrice == null) return null
  return usdFormatter.format(lamportsBNToSolNumber(lamports) * solUsdPrice)
}

const MIN_COL_WIDTH = 72

type ColKey = 'name' | 'group' | 'balance'

function ColumnResizer({ onResize }: { onResize: (deltaX: number) => void }) {
  const lastX = useRef(0)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    lastX.current = e.clientX

    function handleMouseMove(ev: MouseEvent) {
      const delta = ev.clientX - lastX.current
      lastX.current = ev.clientX
      onResize(delta)
    }
    function handleMouseUp() {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      document.body.style.removeProperty('cursor')
      document.body.style.removeProperty('user-select')
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [onResize])

  return (
    <span
      onMouseDown={handleMouseDown}
      onClick={(e) => e.stopPropagation()}
      role="separator"
      aria-orientation="vertical"
      className="group/resizer flex h-5 w-3 shrink-0 cursor-col-resize items-center justify-center"
    >
      <span className="h-full w-0.5 rounded-full bg-muted-foreground/40 transition-colors group-hover/resizer:bg-primary group-active/resizer:bg-primary" />
    </span>
  )
}

export function WalletTable({ wallets, walletTypes, owners, groups, solUsdPrice }: Props) {
  const ownerMap = Object.fromEntries(owners.map((o) => [String(o.id), o.name]))

  const [isActive, setIsActive] = useState<string>(ALL)
  const [walletTypeId, setWalletTypeId] = useState<string>(ALL)
  const [ownerId, setOwnerId] = useState<string>(ALL)
  const [groupId, setGroupId] = useState<string>(ALL)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openItem, setOpenItem] = useState<string>('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [colWidths, setColWidths] = useState<Record<ColKey, number>>({ name: 176, group: 176, balance: 176 })

  const resizeColumn = useCallback((key: ColKey, delta: number) => {
    setColWidths((prev) => ({ ...prev, [key]: Math.max(MIN_COL_WIDTH, prev[key] + delta) }))
  }, [])

  const filtered = useMemo(() => wallets.filter((w) => {
    if (isActive !== ALL && String(w.is_active) !== isActive) return false
    if (walletTypeId !== ALL && w.wallet_type_id !== walletTypeId) return false
    if (ownerId !== ALL && w.owner_record_id !== ownerId) return false
    if (groupId !== ALL && w.wallet_group_id !== groupId) return false
    return true
  }), [wallets, isActive, walletTypeId, ownerId, groupId])

  const totalLamports = useMemo(
    () => wallets.reduce(
      (acc, w) => w.solana_balance_in_lamports ? acc.add(w.solana_balance_in_lamports) : acc,
      new BN(0),
    ),
    [wallets],
  )

  const balancesByType = useMemo(() => {
    const map = new Map<string, { name: string; total: BN; count: number }>()
    for (const w of wallets) {
      const key = w.wallet_type_id ?? 'unassigned'
      const name = w.wallet_type ?? 'Unassigned'
      const entry = map.get(key) ?? { name, total: new BN(0), count: 0 }
      if (w.solana_balance_in_lamports) entry.total = entry.total.add(w.solana_balance_in_lamports)
      entry.count += 1
      map.set(key, entry)
    }
    return Array.from(map.values()).sort((a, b) => b.total.cmp(a.total))
  }, [wallets])

  const allFilteredSelected = filtered.length > 0 && filtered.every((w) => selected.has(w.id))

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allFilteredSelected) {
        filtered.forEach((w) => next.delete(w.id))
      } else {
        filtered.forEach((w) => next.add(w.id))
      }
      return next
    })
  }

  function copyKey(e: React.MouseEvent, key: string, id: string) {
    e.stopPropagation()
    navigator.clipboard.writeText(key)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border bg-muted/40 p-4">
        <p className="text-xs text-muted-foreground mb-0.5">Total SOL Balance</p>
        <p className="text-2xl font-semibold">
          {lamportsBNToSolDisplay(totalLamports)} SOL
          {formatUsd(totalLamports, solUsdPrice) && (
            <span className="ml-2 text-base font-normal text-muted-foreground">
              ({formatUsd(totalLamports, solUsdPrice)})
            </span>
          )}
        </p>

        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 border-t pt-3">
          {balancesByType.map((entry) => (
            <div key={entry.name}>
              <p className="text-xs text-muted-foreground mb-0.5">
                {entry.name} <span className="opacity-70">({entry.count})</span>
              </p>
              <p className="text-sm font-medium">
                {lamportsBNToSolDisplay(entry.total)} SOL
                {formatUsd(entry.total, solUsdPrice) && (
                  <span className="ml-1 font-normal text-muted-foreground">
                    ({formatUsd(entry.total, solUsdPrice)})
                  </span>
                )}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Select value={isActive} onValueChange={setIsActive}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Status</SelectItem>
            <SelectItem value="true">Active</SelectItem>
            <SelectItem value="false">Inactive</SelectItem>
          </SelectContent>
        </Select>

        <Select value={walletTypeId} onValueChange={setWalletTypeId}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Wallet Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Types</SelectItem>
            {walletTypes.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={ownerId} onValueChange={setOwnerId}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Owner" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Owners</SelectItem>
            {owners.map((o) => (
              <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={groupId} onValueChange={setGroupId}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Group" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Groups</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="text-sm text-muted-foreground min-h-5">
        {selected.size > 0 ? `${selected.size} wallet${selected.size !== 1 ? 's' : ''} selected` : ''}
      </p>

      {/* Column header */}
      <div className="flex items-center border-b pb-2 text-sm font-medium text-muted-foreground px-1">
        <span className="flex-1 min-w-0">Public Key</span>
        <span className="shrink-0 truncate" style={{ width: colWidths.name }}>Name</span>
        <ColumnResizer onResize={(d) => resizeColumn('name', d)} />
        <span className="shrink-0 truncate" style={{ width: colWidths.group }}>Group</span>
        <ColumnResizer onResize={(d) => resizeColumn('group', d)} />
        <span className="shrink-0 truncate" style={{ width: colWidths.balance }}>SOL Balance</span>
        <ColumnResizer onResize={(d) => resizeColumn('balance', d)} />
        <Checkbox
          checked={allFilteredSelected}
          onCheckedChange={toggleAll}
          aria-label="Select all"
          className="ml-2 mr-6"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          No wallets match the selected filters.
        </p>
      ) : (
        <Accordion
          type="single"
          collapsible
          value={openItem}
          onValueChange={(val) => setOpenItem(val)}
          className="gap-0"
        >
          {filtered.map((wallet) => (
            <AccordionItem key={wallet.id} value={wallet.id}>
              <AccordionTrigger
                className="hover:no-underline px-1"
                headerSlot={
                  <span onClick={(e) => e.stopPropagation()} className="mr-2 shrink-0 self-center">
                    <Checkbox
                      checked={selected.has(wallet.id)}
                      onCheckedChange={() => toggleOne(wallet.id)}
                      aria-label={`Select wallet ${wallet.id}`}
                    />
                  </span>
                }
              >
                <span className="flex items-center gap-1 flex-1 min-w-0 pr-4">
                  <span className="font-mono text-xs truncate">
                    {wallet.public_key.slice(0, 5)}.....{wallet.public_key.slice(-5)}
                  </span>
                  <TooltipProvider>
                    <Tooltip open={copiedId === wallet.id ? true : undefined}>
                      <TooltipTrigger asChild>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => copyKey(e, wallet.public_key, wallet.id)}
                          onKeyDown={(e) => e.key === 'Enter' && copyKey(e as never, wallet.public_key, wallet.id)}
                          className="flex items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer shrink-0"
                          aria-label="Copy public key"
                        >
                          <Copy className="size-3" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {copiedId === wallet.id ? 'Copied to clipboard' : 'Copy address'}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <a
                          href={`https://solscan.io/account/${wallet.public_key}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
                          aria-label="View on Solscan"
                        >
                          <ExternalLink className="size-3" />
                        </a>
                      </TooltipTrigger>
                      <TooltipContent side="top">View on Solscan</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </span>
                <span
                  className="text-sm font-normal shrink-0 truncate"
                  style={{ width: colWidths.name }}
                  title={wallet.label ?? undefined}
                >
                  {wallet.label ?? '—'}
                </span>
                <span className="w-3 shrink-0" />
                <span
                  className="text-sm font-normal shrink-0 truncate"
                  style={{ width: colWidths.group }}
                  title={wallet.group_name ?? undefined}
                >
                  {wallet.group_name ?? wallet.wallet_group_id ?? '—'}
                </span>
                <span className="w-3 shrink-0" />
                <span
                  className="text-sm font-normal shrink-0 truncate"
                  style={{ width: colWidths.balance }}
                >
                  {wallet.solana_balance_in_lamports ? lamportsBNToSolDisplay(wallet.solana_balance_in_lamports) : '—'}
                </span>
                <span className="w-3 shrink-0" />
              </AccordionTrigger>

              <AccordionContent className="px-1">
                <div className="rounded-lg border bg-muted/40 p-4 grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">ID</p>
                    <p>{wallet.id}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Name</p>
                    <p>{wallet.label ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Created At</p>
                    <p>{wallet.created_at.slice(0, 19).replace('T', ' ')}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Active</p>
                    <p>{wallet.is_active ? 'Yes' : 'No'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Wallet Type</p>
                    <p>{wallet.wallet_type ?? wallet.wallet_type_id ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">SOL Balance</p>
                    <p>{wallet.solana_balance_in_lamports ? lamportsBNToSolDisplay(wallet.solana_balance_in_lamports) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Owner</p>
                    <p>{(wallet.owner_record_id && ownerMap[wallet.owner_record_id]) ?? wallet.owner_record_id ?? '—'}</p>
                  </div>
                  <div className="col-span-2 sm:col-span-3">
                    <p className="text-xs text-muted-foreground mb-1">Token Holdings</p>
                    {wallet.token_holdings && wallet.token_holdings.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {wallet.token_holdings.map((token, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium"
                            title={token.name}
                          >
                            {token.symbol}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">None</span>
                    )}
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem> 
          ))}
        </Accordion>
      )}
    </div>
  )
}

