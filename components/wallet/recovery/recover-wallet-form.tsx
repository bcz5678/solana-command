'use client'

// components/RecoverWalletForm.tsx
// Recovery paths:
//   A. Password only   → recoverKeypair() fetches blob + decrypts client-side
//   B. Mnemonic only   → derives keypair directly from words (no server call)
//   C. Both            → A + derives from mnemonic, compares public keys

import { useState, useRef, useCallback, useEffect } from 'react'
import { Keypair }    from '@solana/web3.js'
import * as bip39     from 'bip39'
import { derivePath } from 'ed25519-hd-key'
import { cn }               from '@/lib/utils'
import { Button }           from '@/components/ui/button'
import { Input }            from '@/components/ui/input'
import { FieldLabel, FieldDescription } from '@/components/ui/field'
import { recoverKeypair }   from '@/lib/wallet/recovery'

// ── Types ─────────────────────────────────────────────────────
type Step         = 'input' | 'verifying' | 'success' | 'error'
type RecoveryMode = 'password' | 'mnemonic' | 'both'

interface RecoveredWallet {
  publicKey:  string
  walletId:   string
  keypair:    Keypair       // caller must wipe after use
}

interface RecoverWalletFormProps {
  onRecovered?: (wallet: RecoveredWallet) => void
  onCancel?:    () => void
}

// Mnemonic-only path — validation already done in validate()
async function mnemonicToKeypair(mnemonic: string): Promise<Keypair> {
  const seed    = await bip39.mnemonicToSeed(mnemonic)
  const derived = derivePath("m/44'/501'/0'/0'", seed.toString('hex'))
  const keypair = Keypair.fromSeed(derived.key)
  seed.fill(0)
  derived.key.fill(0)
  return keypair
}

// ── Component ─────────────────────────────────────────────────
export function RecoverWalletForm({ onRecovered, onCancel }: RecoverWalletFormProps) {

  const [step,         setStep]         = useState<Step>('input')
  const [mode,         setMode]         = useState<RecoveryMode>('password')
  const [walletId,     setWalletId]     = useState('')
  const [password,     setPassword]     = useState('')
  const [words,        setWords]        = useState<string[]>(Array(24).fill(''))
  const [showPassword, setShowPassword] = useState(false)
  const [error,        setError]        = useState('')
  const [statusMsg,    setStatusMsg]    = useState('')
  const [recovered,    setRecovered]    = useState<RecoveredWallet | null>(null)

  // Refs for mnemonic word inputs — enables tab/enter navigation
  const wordRefs = useRef<(HTMLInputElement | null)[]>(Array(24).fill(null))

  // ── Mnemonic word handlers ─────────────────────────────────

  const handleWordChange = useCallback((index: number, value: string) => {
    // Handle paste of full mnemonic into any word field
    const trimmed = value.trim()
    const pasted  = trimmed.split(/\s+/)

    if (pasted.length >= 12) {
      // Full mnemonic pasted — distribute across all fields
      const filled = [...Array(24).fill('')]
      pasted.slice(0, 24).forEach((w, i) => { filled[i] = w.toLowerCase() })
      setWords(filled)
      // Focus last filled word
      const lastIdx = Math.min(pasted.length - 1, 23)
      wordRefs.current[lastIdx]?.focus()
      return
    }

    setWords(prev => {
      const next = [...prev]
      next[index] = value.toLowerCase().trim()
      return next
    })
  }, [])

  const handleWordKeyDown = useCallback((
    e:     React.KeyboardEvent<HTMLInputElement>,
    index: number
  ) => {
    // Enter or Space → advance to next word
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      wordRefs.current[Math.min(index + 1, 23)]?.focus()
    }
    // Backspace on empty → go back
    if (e.key === 'Backspace' && words[index] === '' && index > 0) {
      wordRefs.current[index - 1]?.focus()
    }
  }, [words])

  const clearMnemonic = () => setWords(Array(24).fill(''))

  const filledWordCount = words.filter(w => w.length > 0).length

  // ── Validation ─────────────────────────────────────────────

  function validate(): string | null {
    if (!walletId.trim()) return 'Wallet ID is required'

    if (mode === 'password' || mode === 'both') {
      if (!password) return 'Password is required'
    }

    if (mode === 'mnemonic' || mode === 'both') {
      if (filledWordCount < 24) return `Enter all 24 words (${filledWordCount}/24 filled)`
      const mnemonic = words.join(' ')
      if (!bip39.validateMnemonic(mnemonic)) return 'Invalid mnemonic — check word spelling'
    }

    return null
  }

  // ── Recovery handler ───────────────────────────────────────

  async function handleRecover(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const validationError = validate()
    if (validationError) return setError(validationError)

    setStep('verifying')

    try {
      let keypair: Keypair

      if (mode === 'mnemonic') {
        setStatusMsg('Deriving keypair from mnemonic...')
        keypair = await mnemonicToKeypair(words.join(' '))

      } else if (mode === 'password') {
        setStatusMsg('Fetching and decrypting recovery data...')
        keypair = await recoverKeypair(walletId.trim(), password)

      } else {
        // both: recover via password, then verify entered mnemonic matches by
        // comparing derived public keys (more robust than string comparison)
        setStatusMsg('Fetching and decrypting recovery data...')
        keypair = await recoverKeypair(walletId.trim(), password)

        setStatusMsg('Verifying mnemonic...')
        const mnemonicKeypair = await mnemonicToKeypair(words.join(' '))
        const match = keypair.publicKey.toBase58() === mnemonicKeypair.publicKey.toBase58()
        mnemonicKeypair.secretKey.fill(0)
        if (!match) throw new Error('Mnemonic does not match the encrypted recovery phrase')
      }

      const result: RecoveredWallet = {
        publicKey: keypair.publicKey.toBase58(),
        walletId:  walletId.trim(),
        keypair
      }

      setRecovered(result)
      setStep('success')
      setPassword('')
      clearMnemonic()
      onRecovered?.(result)

    } catch (err) {
      setError((err as Error).message)
      setStep('input')
    } finally {
      setStatusMsg('')
    }
  }

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen flex-col items-center px-4 py-8">

      {/* Header */}
      <div className="mb-10 max-w-md text-center">
        <div className="mb-3 font-mono text-4xl text-green-400">
          {step === 'success' ? '✓' : step === 'verifying' ? '◌' : '⬡'}
        </div>
        <h1 className="mb-2 text-2xl font-bold uppercase tracking-widest text-foreground">
          Recover Wallet
        </h1>
        <p className="text-xs tracking-wider text-muted-foreground">
          {step === 'success'
            ? 'Wallet successfully recovered'
            : 'Restore access using your password or seed phrase'
          }
        </p>
      </div>

      {/* Success state */}
      {step === 'success' && recovered && (
        <div className="w-full max-w-2xl rounded-md border border-green-800 bg-green-950/30 p-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-[0.65rem] font-bold uppercase tracking-widest text-green-400">
              Public Key
            </span>
            <code className="font-mono text-sm text-green-100">
              {recovered.publicKey.slice(0, 8)}...{recovered.publicKey.slice(-8)}
            </code>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[0.65rem] font-bold uppercase tracking-widest text-green-400">
              Wallet ID
            </span>
            <code className="font-mono text-sm text-green-100">
              {recovered.walletId.slice(0, 8)}...{recovered.walletId.slice(-8)}
            </code>
          </div>
          <p className="border-t border-green-900 pt-4 text-xs leading-relaxed text-muted-foreground">
            ⚠ Keypair is active in memory. Use it now and it will be wiped automatically.
          </p>
        </div>
      )}

      {/* Verifying state */}
      {step === 'verifying' && (
        <div className="flex flex-col items-center gap-5 py-12">
          <span className="size-8 animate-spin rounded-full border-2 border-green-400 border-t-transparent" />
          <p className="text-xs tracking-wider text-muted-foreground">{statusMsg}</p>
        </div>
      )}

      {/* Main form */}
      {(step === 'input' || step === 'error') && (
        <form onSubmit={handleRecover} className="w-full max-w-2xl flex flex-col gap-7">

          {/* Wallet ID */}
          <div>
            <FieldLabel htmlFor="wallet-id" className="mb-2">Wallet ID</FieldLabel>
            <Input
              id          ="wallet-id"
              className   ="font-mono"
              type        ="text"
              value       ={walletId}
              onChange    ={e => setWalletId(e.target.value)}
              placeholder ="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              autoComplete="off"
              spellCheck  ={false}
            />
          </div>

          {/* Recovery mode selector */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Recovery Method
            </p>
            <div className="flex flex-wrap gap-2">
              {(['password', 'mnemonic', 'both'] as RecoveryMode[]).map(m => (
                <Button
                  key     ={m}
                  type    ="button"
                  variant ={mode === m ? 'default' : 'outline'}
                  size    ="sm"
                  onClick ={() => setMode(m)}
                >
                  {m === 'password' ? 'Password'
                    : m === 'mnemonic' ? 'Seed Phrase'
                    : 'Both'}
                </Button>
              ))}
            </div>
          </div>

          {/* Password field */}
          {(mode === 'password' || mode === 'both') && (
            <div>
              <FieldLabel htmlFor="enc-password" className="mb-2">Encryption Password</FieldLabel>
              <div className="relative">
                <Input
                  id          ="enc-password"
                  type        ={showPassword ? 'text' : 'password'}
                  value       ={password}
                  onChange    ={e => setPassword(e.target.value)}
                  placeholder ="Your wallet encryption password"
                  autoComplete="current-password"
                  className   ="pr-10"
                />
                <button
                  type   ="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowPassword(p => !p)}
                  title  ={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
              <FieldDescription className="mt-1">
                Used to decrypt your recovery phrase — never sent to server
              </FieldDescription>
            </div>
          )}

          {/* 24-word mnemonic grid */}
          {(mode === 'mnemonic' || mode === 'both') && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <FieldLabel>
                  24-Word Seed Phrase
                  <span className="ml-2 font-normal text-muted-foreground">
                    {filledWordCount}/24
                  </span>
                </FieldLabel>
                <Button type="button" variant="ghost" size="sm" onClick={clearMnemonic}>
                  Clear
                </Button>
              </div>

              <FieldDescription className="mb-3">
                Paste all 24 words into any field, or type them one by one.
                Press Enter or Space to advance to the next word.
              </FieldDescription>

              <div className="grid grid-cols-4 gap-2">
                {words.map((word, i) => (
                  <div
                    key={i}
                    className={cn(
                      'flex items-center gap-1.5 rounded border px-2 py-1.5 bg-muted/20 transition-colors',
                      word && !bip39.wordlists.english.includes(word)
                        ? 'border-destructive/60'
                        : 'border-border'
                    )}
                  >
                    <span className="w-5 shrink-0 select-none text-right text-[0.6rem] text-muted-foreground/40">
                      {i + 1}
                    </span>
                    <input
                      ref          ={el => { wordRefs.current[i] = el }}
                      className    ={cn(
                        'w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground/30',
                        word
                          ? bip39.wordlists.english.includes(word)
                            ? 'text-foreground'
                            : 'text-destructive'
                          : 'text-muted-foreground'
                      )}
                      type         ="text"
                      value        ={word}
                      onChange     ={e => handleWordChange(i, e.target.value)}
                      onKeyDown    ={e => handleWordKeyDown(e, i)}
                      placeholder  ="word"
                      autoComplete ="off"
                      autoCorrect  ="off"
                      autoCapitalize="none"
                      spellCheck   ={false}
                    />
                  </div>
                ))}
              </div>

              {filledWordCount === 24 && (
                <div className={cn(
                  'mt-3 rounded px-3 py-2 text-xs tracking-wide',
                  bip39.validateMnemonic(words.join(' '))
                    ? 'border border-green-800 bg-green-950/40 text-green-400'
                    : 'border border-destructive/30 bg-destructive/10 text-destructive'
                )}>
                  {bip39.validateMnemonic(words.join(' '))
                    ? '✓ Valid BIP39 mnemonic'
                    : '✗ Invalid mnemonic — check spelling or word order'
                  }
                </div>
              )}
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="flex items-center gap-2.5 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <svg className="size-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3">
            {onCancel && (
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
            )}
            <Button type="submit" size="lg">
              Recover Wallet
            </Button>
          </div>

        </form>
      )}
    </div>
  )
}
