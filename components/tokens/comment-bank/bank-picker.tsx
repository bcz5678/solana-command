'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { CommentBank } from '@/lib/types/comment-bank'

type Props = {
  /** When provided, the list includes generic banks plus any bank scoped to this mint, and "New bank" offers a "specific to this token" toggle. */
  mintAddress?: string
  selectedBankIds: Set<string>
  onChange: (ids: Set<string>) => void
  className?: string
}

/**
 * Multi-select bank picker shared across every auto-comment surface (trade
 * wizards, launch-builder node configs, the Comment Bot page). Selecting
 * more than one bank is intentional — the scheduler blends their entries
 * least-used-first, so picking a generic bank + a token-specific one lets
 * the token-specific content get used first without excluding the generic
 * pool once it runs low.
 */
export default function BankPicker({ mintAddress, selectedBankIds, onChange, className }: Props) {
  const [banks, setBanks]     = useState<CommentBank[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating]   = useState(false)
  const [newName, setNewName]     = useState('')
  const [newIsSpecific, setNewIsSpecific] = useState(false)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')

  function refresh() {
    setLoading(true)
    const qs = mintAddress ? `?mintAddress=${encodeURIComponent(mintAddress)}` : ''
    return fetch(`/api/comment-banks${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setBanks((data.banks ?? []) as CommentBank[]) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mintAddress])

  function toggle(id: string) {
    const next = new Set(selectedBankIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }

  async function createBank() {
    if (!newName.trim()) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/comment-banks', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:        newName.trim(),
          mintAddress: newIsSpecific ? mintAddress : undefined,
        }),
      })
      const result = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(result.error ?? `HTTP ${res.status}`)
        return
      }
      await refresh()
      onChange(new Set([...selectedBankIds, result.id as string]))
      setNewName('')
      setNewIsSpecific(false)
      setCreating(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={['flex flex-col gap-2', className].filter(Boolean).join(' ')}>
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading banks…</p>
      ) : banks.length === 0 && !creating ? (
        <p className="text-xs text-muted-foreground">No comment banks yet.</p>
      ) : (
        <div className="flex flex-col gap-1 rounded-md border border-border max-h-40 overflow-y-auto">
          {banks.map((bank) => (
            <label key={bank.id} className="flex items-center gap-2 px-2.5 py-1.5 text-xs cursor-pointer hover:bg-muted/50">
              <input
                type="checkbox"
                checked={selectedBankIds.has(bank.id)}
                onChange={() => toggle(bank.id)}
              />
              <span className="flex-1 truncate">{bank.name}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{bank.entry_count} entries</span>
              <span className={[
                'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
                bank.mint_address ? 'bg-blue-500/15 text-blue-500' : 'bg-muted text-muted-foreground',
              ].join(' ')}>
                {bank.mint_address ? 'This token' : 'Generic'}
              </span>
            </label>
          ))}
        </div>
      )}

      {creating ? (
        <div className="flex flex-col gap-2 rounded-md border border-border p-2.5">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Bank name…"
            className="h-8 w-full rounded border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {mintAddress && (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={newIsSpecific}
                onChange={(e) => setNewIsSpecific(e.target.checked)}
              />
              <span className="text-[10px] text-muted-foreground">Specific to this token only</span>
            </label>
          )}
          {error && <p className="text-[10px] text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" className="h-7 px-2 text-xs" onClick={createBank} disabled={saving || !newName.trim()}>
              {saving ? 'Saving…' : 'Create'}
            </Button>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => { setCreating(false); setError('') }}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="self-start text-[11px] text-blue-500 hover:underline"
        >
          + New bank
        </button>
      )}
    </div>
  )
}
