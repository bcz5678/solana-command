'use client'

import { useEffect, useMemo, useState } from 'react'
import { PublicKey } from '@solana/web3.js'
import { Button } from '@/components/ui/button'
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
} from '@/components/ui/combobox'
import type { CommentBank, CommentBankEntry } from '@/lib/types/comment-bank'
import type { TokenMint } from '@/lib/types/token-mint'

type TokenOption = { value: string; label: string; token: TokenMint }

function maskMint(key: string) {
  return `${key.slice(0, 5)}…${key.slice(-5)}`
}

export default function CommentBanksPage() {
  const [banks, setBanks]               = useState<CommentBank[]>([])
  const [banksLoading, setBanksLoading]  = useState(true)
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null)

  const [tokens, setTokens] = useState<TokenMint[]>([])

  // ── Create form ──────────────────────────────────────────────
  const [creating, setCreating]     = useState(false)
  const [newName, setNewName]       = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newTokenOption, setNewTokenOption] = useState<TokenOption | null>(null)
  const [newTokenInput, setNewTokenInput]   = useState('')
  const [createSaving, setCreateSaving] = useState(false)
  const [createError, setCreateError]   = useState('')

  // ── Rename state ─────────────────────────────────────────────
  const [renamingId, setRenamingId]     = useState<string | null>(null)
  const [renameName, setRenameName]     = useState('')
  const [renameDescription, setRenameDescription] = useState('')
  const [renameSaving, setRenameSaving] = useState(false)

  // ── Delete confirm state ─────────────────────────────────────
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // ── Entries for the selected bank ───────────────────────────
  const [entries, setEntries]         = useState<CommentBankEntry[]>([])
  const [entriesLoading, setEntriesLoading] = useState(false)
  const [importText, setImportText]   = useState('')
  const [importSaving, setImportSaving] = useState(false)
  const [importMessage, setImportMessage] = useState('')
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null)

  function refreshBanks() {
    setBanksLoading(true)
    return fetch('/api/comment-banks')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setBanks((data?.banks ?? []) as CommentBank[]))
      .catch(() => {})
      .finally(() => setBanksLoading(false))
  }

  function refreshEntries(bankId: string) {
    setEntriesLoading(true)
    return fetch(`/api/comment-bank?bankId=${encodeURIComponent(bankId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setEntries((data?.entries ?? []) as CommentBankEntry[]))
      .catch(() => {})
      .finally(() => setEntriesLoading(false))
  }

  useEffect(() => {
    refreshBanks()
    // status=all (not just launched) — banks are pure pre-written text, no
    // live pump.fun call happens here, so there's no reason a bank can't be
    // built for a draft token ahead of its launch. Unlike the trade/comment
    // routes (which need a real bonding curve to exist), this just needs the
    // mint address, and a draft token already has one — see
    // lib/types/token-mint.ts / build_token_draft(): the mint is claimed
    // from a vanity keypair at draft time, not assigned at launch.
    fetch('/api/token-mint/explorer?status=all&limit=1000')
      .then((r) => r.json())
      .then((data) => setTokens((data.tokens ?? []) as TokenMint[]))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (selectedBankId) refreshEntries(selectedBankId)
    else setEntries([])
  }, [selectedBankId])

  const tokenOptions: TokenOption[] = useMemo(
    () => tokens.map((t) => ({
      value: t.id,
      label: `${t.token_symbol} — ${t.token_name}${t.launch_status !== 'launched' ? ` (${t.launch_status})` : ''}`,
      token: t,
    })),
    [tokens],
  )
  const filteredTokenOptions = useMemo(() => {
    const q = newTokenInput.trim().toLowerCase()
    if (!q || newTokenOption) return tokenOptions
    return tokenOptions.filter((o) =>
      o.label.toLowerCase().includes(q) || o.token.mint_public_key?.toLowerCase().includes(q))
  }, [tokenOptions, newTokenInput, newTokenOption])

  const newMintAddress = newTokenOption?.token.mint_public_key ?? newTokenInput.trim()
  const newMintValid = useMemo(() => {
    if (!newMintAddress) return true // empty is valid — means "generic"
    try { new PublicKey(newMintAddress); return true } catch { return false }
  }, [newMintAddress])

  const selectedBank = banks.find((b) => b.id === selectedBankId) ?? null

  async function createBank() {
    if (!newName.trim() || !newMintValid) return
    setCreateSaving(true)
    setCreateError('')
    try {
      const res = await fetch('/api/comment-banks', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:        newName.trim(),
          description: newDescription.trim() || undefined,
          mintAddress: newMintAddress || undefined,
        }),
      })
      const result = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCreateError(result.error ?? `HTTP ${res.status}`)
        return
      }
      setNewName('')
      setNewDescription('')
      setNewTokenOption(null)
      setNewTokenInput('')
      setCreating(false)
      await refreshBanks()
      setSelectedBankId(result.id as string)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreateSaving(false)
    }
  }

  function startRename(bank: CommentBank) {
    setRenamingId(bank.id)
    setRenameName(bank.name)
    setRenameDescription(bank.description ?? '')
  }

  async function saveRename() {
    if (!renamingId || !renameName.trim()) return
    setRenameSaving(true)
    try {
      const res = await fetch(`/api/comment-banks/${renamingId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameName.trim(), description: renameDescription.trim() || undefined }),
      })
      if (res.ok) {
        setRenamingId(null)
        await refreshBanks()
      }
    } catch {
      // best-effort — the rename form just stays open on failure
    } finally {
      setRenameSaving(false)
    }
  }

  async function deleteBank(id: string) {
    const res = await fetch(`/api/comment-banks/${id}`, { method: 'DELETE' })
    setConfirmDeleteId(null)
    if (res.ok) {
      if (selectedBankId === id) setSelectedBankId(null)
      await refreshBanks()
    }
  }

  async function saveImport() {
    const texts = importText.split('\n').map((l) => l.trim()).filter(Boolean)
    if (!selectedBankId || texts.length === 0) return
    setImportSaving(true)
    setImportMessage('')
    try {
      const res = await fetch('/api/comment-bank', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ bankId: selectedBankId, texts }),
      })
      const result = await res.json().catch(() => ({}))
      if (!res.ok) {
        setImportMessage(result.error ?? `HTTP ${res.status}`)
      } else {
        setImportMessage(`Saved ${result.inserted ?? texts.length} entr${(result.inserted ?? texts.length) === 1 ? 'y' : 'ies'}`)
        setImportText('')
        await Promise.all([refreshEntries(selectedBankId), refreshBanks()])
      }
    } catch (err) {
      setImportMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setImportSaving(false)
    }
  }

  async function deleteEntry(id: string) {
    setDeletingEntryId(id)
    try {
      const res = await fetch(`/api/comment-bank?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (res.ok && selectedBankId) {
        await Promise.all([refreshEntries(selectedBankId), refreshBanks()])
      }
    } finally {
      setDeletingEntryId(null)
    }
  }

  return (
    <div className="flex-1 w-full flex flex-col gap-6 p-4">
      <div>
        <h1 className="text-2xl font-bold">Comment Banks</h1>
        <p className="text-sm text-muted-foreground">
          Create, rename, and manage the comment banks that feed auto-comment across trades — and edit each bank&apos;s entries directly.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,360px)_1fr] gap-6">
        {/* ── Bank list ──────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Banks ({banks.length})
            </span>
            {!creating && (
              <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
                + New bank
              </Button>
            )}
          </div>

          {creating && (
            <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Bank name…"
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <input
                type="text"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Description (optional)…"
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-muted-foreground">
                  Specific to a token (optional — leave blank for a generic bank)
                </label>
                <Combobox<TokenOption>
                  value={newTokenOption}
                  onValueChange={(opt) => setNewTokenOption(opt)}
                  inputValue={newTokenInput}
                  onInputValueChange={(val) => {
                    setNewTokenInput(val)
                    if (newTokenOption) setNewTokenOption(null)
                  }}
                  filter={null}
                  isItemEqualToValue={(a, b) => a.value === b.value}
                >
                  <ComboboxInput showClear placeholder="Select a token or paste a mint address…" className="w-full font-mono text-xs" />
                  <ComboboxContent>
                    <ComboboxList>
                      {filteredTokenOptions.map((opt) => (
                        <ComboboxItem key={opt.value} value={opt}>
                          <span className="truncate text-xs">{opt.label}</span>
                        </ComboboxItem>
                      ))}
                      {filteredTokenOptions.length === 0 && (
                        <p className="py-2 text-center text-xs text-muted-foreground">
                          {newTokenInput ? 'No match — paste a full mint address to use it directly' : 'No tokens yet — draft one first'}
                        </p>
                      )}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
                {newTokenInput.trim() && !newTokenOption && !newMintValid && (
                  <p className="text-[10px] text-destructive">Not a valid Solana address</p>
                )}
              </div>
              {createError && <p className="text-xs text-destructive">{createError}</p>}
              <div className="flex gap-2">
                <Button size="sm" onClick={createBank} disabled={createSaving || !newName.trim() || !newMintValid}>
                  {createSaving ? 'Creating…' : 'Create'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setCreating(false); setCreateError('') }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {banksLoading && <p className="text-sm text-muted-foreground">Loading banks…</p>}
            {!banksLoading && banks.length === 0 && !creating && (
              <p className="text-sm text-muted-foreground">No comment banks yet — create one to get started.</p>
            )}
            {banks.map((bank) => (
              <div
                key={bank.id}
                className={[
                  'flex flex-col gap-2 rounded-lg border p-3 transition-colors',
                  selectedBankId === bank.id ? 'border-blue-500 bg-blue-500/5' : 'border-border hover:border-border/80',
                ].join(' ')}
              >
                {renamingId === bank.id ? (
                  <div className="flex flex-col gap-2">
                    <input
                      type="text"
                      value={renameName}
                      onChange={(e) => setRenameName(e.target.value)}
                      className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    <input
                      type="text"
                      value={renameDescription}
                      onChange={(e) => setRenameDescription(e.target.value)}
                      placeholder="Description (optional)…"
                      className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" className="h-7 px-2 text-xs" onClick={saveRename} disabled={renameSaving || !renameName.trim()}>
                        {renameSaving ? 'Saving…' : 'Save'}
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setRenamingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setSelectedBankId(bank.id)}
                      className="flex flex-col items-start gap-1 text-left"
                    >
                      <div className="flex w-full items-center gap-2">
                        <span className="truncate text-sm font-medium">{bank.name}</span>
                        <span className={[
                          'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
                          bank.mint_address ? 'bg-blue-500/15 text-blue-500' : 'bg-muted text-muted-foreground',
                        ].join(' ')}>
                          {bank.mint_address ? maskMint(bank.mint_address) : 'Generic'}
                        </span>
                      </div>
                      {bank.description && (
                        <span className="text-xs text-muted-foreground">{bank.description}</span>
                      )}
                      <span className="text-[10px] text-muted-foreground">{bank.entry_count} entries</span>
                    </button>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => startRename(bank)}>
                        Rename
                      </Button>
                      {confirmDeleteId === bank.id ? (
                        <>
                          <Button size="sm" variant="destructive" className="h-7 px-2 text-xs" onClick={() => deleteBank(bank.id)}>
                            Confirm delete
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setConfirmDeleteId(null)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setConfirmDeleteId(bank.id)}>
                          Delete
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Entries for selected bank ──────────────────────── */}
        <div className="flex flex-col gap-3">
          {!selectedBank ? (
            <div className="flex h-full min-h-48 items-center justify-center rounded-lg border border-dashed border-border">
              <p className="text-sm text-muted-foreground">Select a bank to view and edit its entries.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {selectedBank.name} — {entries.length} entries
                </span>
              </div>

              <div className="flex flex-col gap-2">
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  rows={4}
                  placeholder="Paste new lines to add to this bank, one per line…"
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono shadow-sm placeholder:font-sans placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={saveImport} disabled={importSaving || !importText.trim()}>
                    {importSaving ? 'Saving…' : 'Add to bank'}
                  </Button>
                  {importMessage && <p className="text-xs text-muted-foreground">{importMessage}</p>}
                </div>
              </div>

              <div className="rounded-lg border border-border overflow-hidden">
                {entriesLoading ? (
                  <p className="p-3 text-sm text-muted-foreground">Loading entries…</p>
                ) : entries.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">No entries yet — add some above.</p>
                ) : (
                  <div className="max-h-[28rem] overflow-y-auto divide-y divide-border">
                    {entries.map((entry) => (
                      <div key={entry.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                        <span className="flex-1 truncate">{entry.text}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">used {entry.used_count}×</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                          onClick={() => deleteEntry(entry.id)}
                          disabled={deletingEntryId === entry.id}
                        >
                          {deletingEntryId === entry.id ? 'Removing…' : 'Remove'}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
