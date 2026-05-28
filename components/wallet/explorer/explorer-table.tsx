'use client'

import { useState, useMemo } from 'react'
import { lamportsBNToSolDisplay } from '@/lib/lamports';

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
import { Copy } from 'lucide-react'
import { WalletRecord } from '@/lib/types/wallet';

type Token = { symbol: string; name: string }

type LookupEntry = { id: number; name: string }

type Props = {
  wallets: WalletRecord[]
  walletTypes: LookupEntry[]
  owners: LookupEntry[]
  groups: LookupEntry[]
}

const ALL = 'all'

export function WalletTable({ wallets, walletTypes, owners, groups }: Props) {
  const ownerMap = Object.fromEntries(owners.map((o) => [String(o.id), o.name]))

  const [isActive, setIsActive] = useState<string>(ALL)
  const [walletTypeId, setWalletTypeId] = useState<string>(ALL)
  const [ownerId, setOwnerId] = useState<string>(ALL)
  const [groupId, setGroupId] = useState<string>(ALL)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [openItem, setOpenItem] = useState<string>('')
  const [copiedId, setCopiedId] = useState<number | null>(null)

  const filtered = useMemo(() => wallets.filter((w) => {
    if (isActive !== ALL && String(w.is_active) !== isActive) return false
    if (walletTypeId !== ALL && w.wallet_type_id !== walletTypeId) return false
    if (ownerId !== ALL && w.owner_record_id !== ownerId) return false
    if (groupId !== ALL && w.wallet_group_id !== groupId) return false
    return true
  }), [wallets, isActive, walletTypeId, ownerId, groupId])

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

  function copyKey(e: React.MouseEvent, key: string, id: number) {
    e.stopPropagation()
    navigator.clipboard.writeText(key)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-4">
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
              <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
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
              <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>
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
              <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="text-sm text-muted-foreground min-h-5">
        {selected.size > 0 ? `${selected.size} wallet${selected.size !== 1 ? 's' : ''} selected` : ''}
      </p>

      {/* Column header */}
      <div className="flex items-center gap-4 border-b pb-2 text-sm font-medium text-muted-foreground px-1">
        <span className="flex-1">Public Key</span>
        <span className="w-36">Group</span>
        <span className="w-28">SOL Balance</span>
        <Checkbox
          checked={allFilteredSelected}
          onCheckedChange={toggleAll}
          aria-label="Select all"
          className="mr-6"
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
            <AccordionItem key={wallet.id} value={String(wallet.id)}>
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
                </span>
                <span className="w-36 text-sm font-normal shrink-0">
                  {wallet.group_name ?? wallet.wallet_group_id ?? '—'}
                </span>
                <span className="w-28 text-sm font-normal shrink-0">
                  {wallet.solana_balance_in_lamports ? lamportsBNToSolDisplay(wallet.solana_balance_in_lamports) : '—'}
                </span>
              </AccordionTrigger>

              <AccordionContent className="px-1">
                <div className="rounded-lg border bg-muted/40 p-4 grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">ID</p>
                    <p>{wallet.id}</p>
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

