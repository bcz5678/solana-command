'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { PublicKey } from '@solana/web3.js'
import { Button } from '@/components/ui/button'
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
} from '@/components/ui/combobox'
import type { WalletRecord } from '@/lib/types/wallet'
import type { TokenMint } from '@/lib/types/token-mint'
import type { CommentBank, CommentBankEntry } from '@/lib/types/comment-bank'
import BankPicker from '@/components/tokens/comment-bank/bank-picker'

type TokenOption = { value: string; label: string; token: TokenMint }

type RowStatus = 'pending' | 'running' | 'posted' | 'failed'

interface CommentRow {
  walletId:      string
  walletLabel:   string
  text:          string
  commentBankId?: string
  status:        RowStatus
  error?:        string
}

function maskPubKey(key: string) {
  return `${key.slice(0, 5)}…${key.slice(-5)}`
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function StatusDot({ status }: { status: RowStatus }) {
  if (status === 'pending') return <span className="size-2 shrink-0 rounded-full bg-muted-foreground/30" />
  if (status === 'running') return <span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
  if (status === 'posted')  return <span className="size-2 shrink-0 rounded-full bg-green-500" />
  return <span className="size-2 shrink-0 rounded-full bg-destructive" />
}

export default function CommentBotPage() {
  const [wallets, setWallets]               = useState<WalletRecord[]>([])
  const [walletsLoading, setWalletsLoading]  = useState(true)
  const [selectedWalletIds, setSelectedWalletIds] = useState<Set<string>>(new Set())

  const [tokens, setTokens]                 = useState<TokenMint[]>([])
  const [selectedOption, setSelectedOption] = useState<TokenOption | null>(null)
  const [mintInputValue, setMintInputValue] = useState('')

  // walletId -> raw on-chain token amount (string) for the selected mint.
  // Callouts only stay visible while the posting wallet still holds the
  // token, so only holders are worth showing as candidates at all.
  const [tokenBalances, setTokenBalances]     = useState<Record<string, string>>({})
  const [balancesLoading, setBalancesLoading] = useState(false)

  const [commentSource, setCommentSource] = useState<'manual' | 'bank'>('manual')
  const [commentsInput, setCommentsInput] = useState('')

  // Which bank(s) to pull FROM when running — least-used-first across their union.
  const [selectedBankIds, setSelectedBankIds] = useState<Set<string>>(new Set())
  const [bankEntries, setBankEntries]         = useState<CommentBankEntry[]>([])
  const [bankEntriesLoading, setBankEntriesLoading] = useState(false)

  // Which single bank to import new pasted lines INTO — separate from the pull-from set above.
  const [importBanks, setImportBanks]         = useState<CommentBank[]>([])
  const [importBankId, setImportBankId]       = useState('')
  const [bankImportText, setBankImportText]   = useState('')
  const [bankSaving, setBankSaving]           = useState(false)
  const [bankImportMessage, setBankImportMessage] = useState('')

  const [delayMinMs, setDelayMinMs]       = useState(3000)
  const [delayMaxMs, setDelayMaxMs]       = useState(8000)

  const [rows, setRows]       = useState<CommentRow[]>([])
  const [running, setRunning] = useState(false)
  const stopRef = useRef(false)

  // Reply to an existing callout — a single-wallet action, and unlike the
  // bulk poster above the wallet doesn't need to still hold the token
  // (replying to your own callout stays eligible after the position closes),
  // so this uses the full wallet list rather than holdingWallets.
  const [replyWalletId, setReplyWalletId]         = useState('')
  const [replyCalloutId, setReplyCalloutId]       = useState<string | null>(null)
  const [replyCalloutThesis, setReplyCalloutThesis] = useState<string | null>(null)
  const [replyLookupLoading, setReplyLookupLoading] = useState(false)
  const [replyLookupError, setReplyLookupError]   = useState<string | null>(null)
  const [replyText, setReplyText]                 = useState('')
  const [replySending, setReplySending]           = useState(false)
  const [replyResult, setReplyResult]             = useState<{ success: boolean; message: string } | null>(null)

  // Merges entries across every selected bank and sorts least-used-first —
  // mirrors claim_comment_bank_entry()'s ordering so manual "Start" here
  // behaves the same as the durable scheduler's pick.
  function refreshBankEntries(bankIds: Set<string>) {
    if (bankIds.size === 0) {
      setBankEntries([])
      return Promise.resolve()
    }
    setBankEntriesLoading(true)
    return Promise.all(
      [...bankIds].map((id) =>
        fetch(`/api/comment-bank?bankId=${encodeURIComponent(id)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => (data?.entries ?? []) as CommentBankEntry[])
          .catch(() => [] as CommentBankEntry[]),
      ),
    )
      .then((lists) => {
        const merged = lists.flat().sort((a, b) => {
          if (a.used_count !== b.used_count) return a.used_count - b.used_count
          const aLast = a.last_used_at ? new Date(a.last_used_at).getTime() : -Infinity
          const bLast = b.last_used_at ? new Date(b.last_used_at).getTime() : -Infinity
          if (aLast !== bLast) return aLast - bLast
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        })
        setBankEntries(merged)
      })
      .finally(() => setBankEntriesLoading(false))
  }

  function refreshImportBanks() {
    const qs = mintValid ? `?mintAddress=${encodeURIComponent(mintAddress)}` : ''
    return fetch(`/api/comment-banks${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const list = (data?.banks ?? []) as CommentBank[]
        setImportBanks(list)
        setImportBankId((prev) => (prev && list.some((b) => b.id === prev)) ? prev : (list[0]?.id ?? ''))
      })
      .catch(() => {})
  }

  useEffect(() => {
    fetch('/api/wallets/explorer')
      .then((r) => r.json())
      .then((data) => setWallets((data.wallets ?? []) as WalletRecord[]))
      .catch(() => {})
      .finally(() => setWalletsLoading(false))

    fetch('/api/token-mint/explorer?status=launched&limit=1000')
      .then((r) => r.json())
      .then((data) => setTokens((data.tokens ?? []) as TokenMint[]))
      .catch(() => {})
  }, [])

  useEffect(() => {
    refreshBankEntries(selectedBankIds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBankIds])

  async function saveBankImport() {
    const texts = bankImportText.split('\n').map((l) => l.trim()).filter(Boolean)
    if (texts.length === 0 || !importBankId) return
    setBankSaving(true)
    setBankImportMessage('')
    try {
      const res = await fetch('/api/comment-bank', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ bankId: importBankId, texts }),
      })
      const result = await res.json().catch(() => ({}))
      if (!res.ok) {
        setBankImportMessage(result.error ?? `HTTP ${res.status}`)
      } else {
        setBankImportMessage(`Saved ${result.inserted ?? texts.length} entr${(result.inserted ?? texts.length) === 1 ? 'y' : 'ies'}`)
        setBankImportText('')
        await Promise.all([refreshImportBanks(), refreshBankEntries(selectedBankIds)])
      }
    } catch (err) {
      setBankImportMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBankSaving(false)
    }
  }

  function toggleWallet(id: string) {
    setSelectedWalletIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const tokenOptions: TokenOption[] = useMemo(
    () => tokens.map((t) => ({ value: t.id, label: `${t.token_symbol} — ${t.token_name}`, token: t })),
    [tokens],
  )

  const filteredTokenOptions = useMemo(() => {
    const q = mintInputValue.trim().toLowerCase()
    if (!q || selectedOption) return tokenOptions
    return tokenOptions.filter((o) =>
      o.label.toLowerCase().includes(q) ||
      o.token.mint_public_key?.toLowerCase().includes(q),
    )
  }, [tokenOptions, mintInputValue, selectedOption])

  // Selecting a known token uses its mint directly; otherwise fall back to
  // whatever was typed/pasted, so an address for a token not in our DB still works.
  const mintAddress = selectedOption?.token.mint_public_key ?? mintInputValue.trim()

  const mintValid = useMemo(() => {
    if (!mintAddress) return false
    try {
      new PublicKey(mintAddress)
      return true
    } catch {
      return false
    }
  }, [mintAddress])

  useEffect(() => {
    refreshImportBanks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mintValid])

  useEffect(() => {
    if (!mintValid || wallets.length === 0) {
      setTokenBalances({})
      return
    }
    let cancelled = false
    setBalancesLoading(true)
    fetch('/api/wallet/token-balances', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ mintAddress, walletAddresses: wallets.map((w) => w.public_key) }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        const byId: Record<string, string> = {}
        for (const w of wallets) {
          const bal = data.balances?.[w.public_key]
          if (bal !== undefined) byId[w.id] = bal
        }
        setTokenBalances(byId)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setBalancesLoading(false) })
    return () => { cancelled = true }
  }, [mintValid, mintAddress, wallets])

  // Callouts require the posting wallet to actually hold the token — and stay
  // visible only while it keeps holding — so non-holders aren't valid choices.
  const holdingWallets = useMemo(() => {
    if (!mintValid) return wallets
    return wallets.filter((w) => {
      const bal = tokenBalances[w.id]
      return bal !== undefined && bal !== '0'
    })
  }, [wallets, mintValid, tokenBalances])

  useEffect(() => {
    if (!mintValid) return
    const holderIds = new Set(holdingWallets.map((w) => w.id))
    setSelectedWalletIds((prev) => {
      const pruned = new Set([...prev].filter((id) => holderIds.has(id)))
      return pruned.size === prev.size ? prev : pruned
    })
  }, [holdingWallets, mintValid])

  // Auto-resolve "my callout" for the selected reply wallet + the page's
  // selected mint — the caller never needs pump.fun's raw calloutId.
  useEffect(() => {
    setReplyResult(null)
    if (!replyWalletId || !mintValid) {
      setReplyCalloutId(null)
      setReplyCalloutThesis(null)
      setReplyLookupError(null)
      return
    }
    let cancelled = false
    setReplyLookupLoading(true)
    fetch(`/api/pumpfun/callout-reply?walletId=${encodeURIComponent(replyWalletId)}&mintAddress=${encodeURIComponent(mintAddress)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        if (data.error) {
          setReplyCalloutId(null)
          setReplyCalloutThesis(null)
          setReplyLookupError(data.error)
        } else {
          setReplyCalloutId(data.calloutId ?? null)
          setReplyCalloutThesis(data.thesis ?? null)
          setReplyLookupError(data.calloutId ? null : 'This wallet hasn’t called out this token yet.')
        }
      })
      .catch((err) => { if (!cancelled) setReplyLookupError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (!cancelled) setReplyLookupLoading(false) })
    return () => { cancelled = true }
  }, [replyWalletId, mintValid, mintAddress])

  async function submitReply() {
    if (!replyWalletId || !replyCalloutId || !replyText.trim()) return
    setReplySending(true)
    setReplyResult(null)
    try {
      const res = await fetch('/api/pumpfun/callout-reply', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ walletId: replyWalletId, calloutId: replyCalloutId, text: replyText.trim() }),
      })
      const result = await res.json().catch(() => ({}))
      setReplyResult({
        success: res.ok,
        message: res.ok ? 'Reply posted!' : (result.error ?? `HTTP ${res.status}`),
      })
      if (res.ok) setReplyText('')
    } catch (err) {
      setReplyResult({ success: false, message: err instanceof Error ? err.message : String(err) })
    } finally {
      setReplySending(false)
    }
  }

  const hasCommentSource = commentSource === 'bank' ? bankEntries.length > 0 : commentsInput.trim().length > 0
  const canStart = !running && mintValid && selectedWalletIds.size > 0 && hasCommentSource

  async function startLoop() {
    const selected = holdingWallets.filter((w) => selectedWalletIds.has(w.id))
    if (!mintValid || selected.length === 0) return

    const mint = mintAddress
    let initialRows: CommentRow[]

    if (commentSource === 'bank') {
      if (bankEntries.length === 0) return
      // Bank is already ordered least-used-first by the API, so a straight
      // walk (cycling if fewer entries than wallets) naturally spreads usage.
      initialRows = selected.map((w, i) => {
        const entry = bankEntries[i % bankEntries.length]
        return {
          walletId:      w.id,
          walletLabel:   w.label ?? maskPubKey(w.public_key),
          text:          entry.text,
          commentBankId: entry.id,
          status:        'pending' as const,
        }
      })
    } else {
      const commentLines = commentsInput.split('\n').map((l) => l.trim()).filter(Boolean)
      if (commentLines.length === 0) return
      initialRows = selected.map((w, i) => ({
        walletId:    w.id,
        walletLabel: w.label ?? maskPubKey(w.public_key),
        text:        commentLines[i % commentLines.length],
        status:      'pending' as const,
      }))
    }

    setRows(initialRows)
    setRunning(true)
    stopRef.current = false

    for (let i = 0; i < initialRows.length; i++) {
      if (stopRef.current) break

      setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: 'running' } : r)))

      try {
        const res = await fetch('/api/pumpfun/comment', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            walletId:      initialRows[i].walletId,
            mintAddress:   mint,
            text:          initialRows[i].text,
            commentBankId: initialRows[i].commentBankId,
          }),
        })
        const result = await res.json().catch(() => ({}))
        setRows((prev) => prev.map((r, idx) => (idx === i
          ? { ...r, status: res.ok ? 'posted' : 'failed', error: res.ok ? undefined : (result.error ?? `HTTP ${res.status}`) }
          : r)))
      } catch (err) {
        setRows((prev) => prev.map((r, idx) => (idx === i
          ? { ...r, status: 'failed', error: err instanceof Error ? err.message : String(err) }
          : r)))
      }

      if (i < initialRows.length - 1 && !stopRef.current) {
        await wait(delayMinMs + Math.random() * Math.max(0, delayMaxMs - delayMinMs))
      }
    }

    setRunning(false)
    if (commentSource === 'bank') refreshBankEntries(selectedBankIds)
  }

  function stopLoop() {
    stopRef.current = true
  }

  const postedCount = rows.filter((r) => r.status === 'posted').length
  const failedCount = rows.filter((r) => r.status === 'failed').length

  return (
    <div className="flex-1 w-full flex flex-col gap-6 p-4 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Comment Bot</h1>
        <p className="text-sm text-muted-foreground">
          Posts a pump.fun &quot;Callout&quot; (comment + thesis) to a token from selected wallets. Each wallet can post once per token, must currently hold it, and the callout disappears if the wallet sells.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Target mint</label>
        <Combobox<TokenOption>
          value={selectedOption}
          onValueChange={(opt) => setSelectedOption(opt)}
          inputValue={mintInputValue}
          onInputValueChange={(val) => {
            setMintInputValue(val)
            if (selectedOption) setSelectedOption(null)
          }}
          filter={null}
          isItemEqualToValue={(a, b) => a.value === b.value}
        >
          <ComboboxInput showClear placeholder="Select a launched token or paste a mint address…" className="w-full font-mono" />
          <ComboboxContent>
            <ComboboxList>
              {filteredTokenOptions.map((opt) => (
                <ComboboxItem key={opt.value} value={opt}>
                  <div className="flex w-full min-w-0 items-center gap-3">
                    {opt.token.logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={opt.token.logo_url} alt="" className="size-6 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
                        {opt.token.token_symbol.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-xs font-medium text-foreground">{opt.token.token_name}</span>
                      <span className="truncate font-mono text-[10px] text-muted-foreground">{opt.token.mint_public_key ?? '—'}</span>
                    </span>
                    <span className="ml-auto shrink-0 text-[10px] font-medium text-muted-foreground">{opt.token.token_symbol}</span>
                  </div>
                </ComboboxItem>
              ))}
              {filteredTokenOptions.length === 0 && (
                <p className="py-2 text-center text-sm text-muted-foreground">
                  {mintInputValue ? 'No matching token — paste a full mint address to use it directly' : 'No launched tokens yet'}
                </p>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
        {mintInputValue.trim() && !selectedOption && !mintValid && (
          <p className="text-xs text-destructive">Not a valid Solana address</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Wallets ({selectedWalletIds.size} selected)
        </label>
        {mintValid && (
          <p className="text-xs text-muted-foreground">
            Only wallets currently holding this token are shown — a callout requires holding it to post, and disappears if the wallet sells.
          </p>
        )}
        <div className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border">
          {walletsLoading && <p className="p-3 text-sm text-muted-foreground">Loading wallets…</p>}
          {!walletsLoading && mintValid && balancesLoading && (
            <p className="p-3 text-sm text-muted-foreground">Checking token balances…</p>
          )}
          {!walletsLoading && !(mintValid && balancesLoading) && wallets.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">No wallets found.</p>
          )}
          {!walletsLoading && !(mintValid && balancesLoading) && wallets.length > 0 && mintValid && holdingWallets.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">No wallets currently hold this token — buy first.</p>
          )}
          {!walletsLoading && !(mintValid && balancesLoading) && holdingWallets.map((w) => (
            <label key={w.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50">
              <input
                type="checkbox"
                checked={selectedWalletIds.has(w.id)}
                onChange={() => toggleWallet(w.id)}
              />
              <span className="flex-1 truncate">{w.label ?? maskPubKey(w.public_key)}</span>
              <span className="font-mono text-xs text-muted-foreground">{maskPubKey(w.public_key)}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
        <div>
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Reply to my callout</label>
          <p className="mt-1 text-xs text-muted-foreground">
            Post a follow-up under a wallet&apos;s existing callout for the token selected above. Unlike posting a new callout, the wallet doesn&apos;t need to still hold the token.
          </p>
        </div>

        {!mintValid ? (
          <p className="text-xs text-muted-foreground">Select a target mint above first.</p>
        ) : (
          <>
            <select
              value={replyWalletId}
              onChange={(e) => setReplyWalletId(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">Select a wallet…</option>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>{w.label ?? maskPubKey(w.public_key)}</option>
              ))}
            </select>

            {replyWalletId && (
              <>
                {replyLookupLoading && <p className="text-xs text-muted-foreground">Checking for an existing callout…</p>}
                {!replyLookupLoading && replyCalloutId && (
                  <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Replying to</p>
                    <p className="truncate text-xs">{replyCalloutThesis || '(no thesis text)'}</p>
                  </div>
                )}
                {!replyLookupLoading && !replyCalloutId && replyLookupError && (
                  <p className="text-xs text-muted-foreground">{replyLookupError}</p>
                )}

                {replyCalloutId && (
                  <>
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      rows={2}
                      placeholder="Add a reply…"
                      className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    <div className="flex items-center gap-2">
                      <Button size="sm" onClick={submitReply} disabled={replySending || !replyText.trim()}>
                        {replySending ? 'Posting…' : 'Post reply'}
                      </Button>
                      {replyResult && (
                        <p className={`text-xs ${replyResult.success ? 'text-green-500' : 'text-destructive'}`}>
                          {replyResult.message}
                        </p>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Comments
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setCommentSource('manual')}
              className={[
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                commentSource === 'manual'
                  ? 'border-blue-500 bg-blue-500 text-white'
                  : 'border-border text-muted-foreground hover:border-blue-400 hover:text-foreground',
              ].join(' ')}
            >
              Manual
            </button>
            <button
              type="button"
              onClick={() => setCommentSource('bank')}
              className={[
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                commentSource === 'bank'
                  ? 'border-blue-500 bg-blue-500 text-white'
                  : 'border-border text-muted-foreground hover:border-blue-400 hover:text-foreground',
              ].join(' ')}
            >
              Banks ({selectedBankIds.size} selected, {bankEntries.length} entries)
            </button>
          </div>
        </div>

        {commentSource === 'manual' ? (
          <>
            <p className="text-xs text-muted-foreground">One per line — cycled across selected wallets.</p>
            <textarea
              value={commentsInput}
              onChange={(e) => setCommentsInput(e.target.value)}
              rows={5}
              placeholder={'gm\nthis is looking good\nlfg'}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </>
        ) : (
          <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">
              Pick one or more banks — a generic bank plus one written for this token works well.
              Pulls least-used entries first across all selected banks, one per selected wallet, and marks each used after a successful post.
            </p>

            <BankPicker
              mintAddress={mintValid ? mintAddress : undefined}
              selectedBankIds={selectedBankIds}
              onChange={setSelectedBankIds}
            />

            {bankEntriesLoading ? (
              <p className="text-xs text-muted-foreground">Loading entries…</p>
            ) : bankEntries.length > 0 && (
              <div className="max-h-32 overflow-y-auto rounded-md border border-border divide-y divide-border">
                {bankEntries.slice(0, 20).map((entry) => (
                  <div key={entry.id} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                    <span className="flex-1 truncate">{entry.text}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">used {entry.used_count}×</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-2 border-t border-border pt-3">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Import into
              </label>
              {importBanks.length === 0 ? (
                <p className="text-xs text-muted-foreground">Create a bank above first.</p>
              ) : (
                <select
                  value={importBankId}
                  onChange={(e) => setImportBankId(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {importBanks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} {b.mint_address ? '(this token)' : '(generic)'}
                    </option>
                  ))}
                </select>
              )}
              <textarea
                value={bankImportText}
                onChange={(e) => setBankImportText(e.target.value)}
                rows={4}
                placeholder={'paste your bank here, one line per comment'}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono shadow-sm placeholder:font-sans placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={saveBankImport}
                  disabled={bankSaving || !bankImportText.trim() || !importBankId}
                >
                  {bankSaving ? 'Saving…' : 'Save to bank'}
                </Button>
                {bankImportMessage && <p className="text-xs text-muted-foreground">{bankImportMessage}</p>}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-4">
        <div className="flex flex-1 flex-col gap-2">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Min delay (ms)</label>
          <input
            type="number"
            value={delayMinMs}
            min={0}
            onChange={(e) => setDelayMinMs(Number(e.target.value))}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Max delay (ms)</label>
          <input
            type="number"
            value={delayMaxMs}
            min={0}
            onChange={(e) => setDelayMaxMs(Number(e.target.value))}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
      </div>

      <div className="flex gap-2">
        <Button onClick={startLoop} disabled={!canStart}>
          {running ? 'Running…' : 'Start'}
        </Button>
        {running && (
          <Button variant="outline" onClick={stopLoop}>Stop</Button>
        )}
      </div>

      {rows.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-medium">{running ? 'Posting…' : 'Done'}</p>
            <p className="text-xs text-muted-foreground">
              {postedCount}/{rows.length} posted{failedCount > 0 ? `, ${failedCount} failed` : ''}
            </p>
          </div>
          <div className="max-h-96 overflow-y-auto divide-y divide-border">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                <StatusDot status={r.status} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{r.walletLabel}</p>
                  <p className="truncate text-xs text-muted-foreground">{r.text}</p>
                  {r.status === 'failed' && r.error && (
                    <p className="truncate text-[11px] text-destructive">{r.error}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
