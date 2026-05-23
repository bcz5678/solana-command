'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupInput } from '@/components/ui/input-group'
import {
    estimateVanityMintAttempts,
    generateVanityMint,
    VanityErrorType
} from '@/modules/vanityMint'

type MintStatus = 'idle' | 'running' | 'stopped' | 'complete'
type ImportStatus = 'idle' | 'importing' | 'done' | 'error'

type ImportResult = { filename: string; ok: boolean; message?: string }


export default function VanityAddressCreatorForm() {
    const [targetCount, setTargetCount] = useState<string>('')

    const [mintStatus, setMintStatus] = useState<MintStatus>('idle')
    const [statusMessage, setStatusMessage] = useState('')
    const [foundAddresses, setFoundAddresses] = useState<string[]>([])

    const abortControllerRef = useRef<AbortController | null>(null)

    // --- import form state ---
    const [importFiles, setImportFiles] = useState<FileList | null>(null)
    const [importStatus, setImportStatus] = useState<ImportStatus>('idle')
    const [importResults, setImportResults] = useState<ImportResult[]>([])
    const fileInputRef = useRef<HTMLInputElement>(null)

    async function handleStart() {
        const controller = new AbortController()
        abortControllerRef.current = controller

        const limit = targetCount.trim() !== '' ? parseInt(targetCount, 10) : Infinity
        let count = 0

        setMintStatus('running')
        setStatusMessage('')
        setFoundAddresses([])

        try {
            const expected = estimateVanityMintAttempts({ suffix: 'pump' });

            while (count < limit) {
                const current = count + 1

                const { keypair: mint, attempts, durationMs } = await generateVanityMint({
                    suffix: 'pump',
                    onProgress: ({ attempts, elapsedMs }) => {
                        if (attempts % 5_000 === 0) {
                            setStatusMessage(`${attempts.toLocaleString()}/~${expected} attempts tried in ${(elapsedMs/1000).toFixed(1)}s`);
                        }
                    },
                });

                const address = mint.publicKey.toBase58()

                const saveRes = await fetch('/api/vanity-keypairs/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        mintKeypair: Array.from(mint.secretKey),
                        contractAddress: address,
                    }),
                })
                if (!saveRes.ok) {
                    const json = await saveRes.json()
                    throw new Error(`DB insert failed: ${json.error ?? saveRes.statusText}`)
                }
                setFoundAddresses((prev) => [...prev, address])
                setStatusMessage(
                    `Found address ${current}${isFinite(limit) ? `/${limit}` : ''} in ${durationMs}ms`,
                )
                count++
            }
            setMintStatus('complete')
            setStatusMessage(`Done — ${count} address${count !== 1 ? 'es' : ''} generated.`)
        } catch (err: unknown) {
            const isCancelled =
                err instanceof Error && 'type' in err &&
                (err as { type: string }).type === VanityErrorType.Cancelled
            if (isCancelled) {
                setMintStatus('stopped')
                setStatusMessage(`Stopped after ${count} address${count !== 1 ? 'es' : ''}.`)
            } else {
                setMintStatus('stopped')
                setStatusMessage(`Error: ${err instanceof Error ? err.message : String(err)}`)
            }
        }
    }

    function handleStop() {
        abortControllerRef.current?.abort()
    }

    async function handleImport() {
        if (!importFiles || importFiles.length === 0) return

        setImportStatus('importing')
        setImportResults([])

        const results: ImportResult[] = []

        const body = new FormData()
        for (const file of Array.from(importFiles)) body.append('files', file)

        try {
            const res = await fetch('/api/vanity-keypairs/import', { method: 'POST', body })
            if (!res.ok) {
                const text = await res.text()
                results.push({ filename: '(all files)', ok: false, message: `${res.status} ${text}` })
            } else {
                const json = await res.json()
                results.push(...(json.results ?? []))
            }
        } catch (err) {
            results.push({ filename: '(all files)', ok: false, message: err instanceof Error ? err.message : String(err) })
        }

        setImportResults(results)
        setImportStatus(results.every((r) => r.ok) ? 'done' : 'error')
        setImportFiles(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
    }

    const isRunning = mintStatus === 'running'
    const isImporting = importStatus === 'importing'

    const statusBoxColor = {
        running: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
        stopped: 'bg-muted text-muted-foreground',
        complete: 'bg-green-500/10 text-green-700 dark:text-green-400',
        idle: '',
    }[mintStatus]

    return (
        <div className="flex flex-col gap-10">
            {/* Generator */}
            <div className="grid grid-cols-3 gap-4">
                <div className="flex flex-col gap-4">
                    <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Configuration
                    </p>

                    <div>
                        <FieldLabel htmlFor="input-count">
                            Number of addresses{' '}
                            <span className="font-normal text-muted-foreground">(leave empty to run until stopped)</span>
                        </FieldLabel>
                        <InputGroup className="mt-2">
                            <InputGroupInput
                                id="input-count"
                                type="number"
                                min={1}
                                step={1}
                                value={targetCount}
                                onChange={(e) => setTargetCount(e.target.value)}
                                placeholder="∞"
                                disabled={isRunning}
                            />
                        </InputGroup>
                    </div>

                    {mintStatus !== 'idle' && (
                        <div className={`rounded-md px-3 py-2.5 text-sm flex flex-col gap-1 ${statusBoxColor}`}>
                            <span className="flex items-center gap-2 font-medium">
                                {mintStatus === 'running' ? (
                                    <>
                                        <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent shrink-0" />
                                        Grinding vanity addresses…
                                    </>
                                ) : mintStatus === 'complete' ? (
                                    <>
                                        <svg className="size-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                        </svg>
                                        Complete
                                    </>
                                ) : (
                                    <>
                                        <svg className="size-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
                                        </svg>
                                        Stopped
                                    </>
                                )}
                            </span>
                            {statusMessage && (
                                <span className="font-mono text-xs opacity-80">{statusMessage}</span>
                            )}
                        </div>
                    )}

                    <div className="flex gap-2">
                        <Button
                            size="lg"
                            variant="default"
                            onClick={handleStart}
                            disabled={isRunning}
                            className="flex-1"
                        >
                            {isRunning ? (
                                <span className="flex items-center gap-2">
                                    <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                    Running…
                                </span>
                            ) : 'Start Creating'}
                        </Button>

                        <Button
                            size="lg"
                            variant="outline"
                            onClick={handleStop}
                            disabled={!isRunning}
                        >
                            Stop
                        </Button>
                    </div>

                    {foundAddresses.length > 0 && (
                        <div className="flex flex-col gap-1">
                            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Found ({foundAddresses.length})
                            </p>
                            <div className="max-h-64 overflow-y-auto flex flex-col gap-1 rounded-md border bg-muted/40 p-2">
                                {foundAddresses.map((addr, i) => (
                                    <span key={i} className="font-mono text-xs px-2 py-1 rounded bg-background border border-border">
                                        {addr}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <hr className="border-border" />

            {/* Importer */}
            <div className="grid grid-cols-3 gap-4">
                <div className="flex flex-col gap-4">
                    <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Import Keypair Files
                    </p>

                    <div>
                        <FieldLabel htmlFor="input-keypair-files" className="mb-2">
                            Keypair JSON files{' '}
                            <span className="font-normal text-muted-foreground">(filename = contract address)</span>
                        </FieldLabel>
                        <input
                            ref={fileInputRef}
                            id="input-keypair-files"
                            type="file"
                            accept=".json"
                            multiple
                            disabled={isImporting}
                            onChange={(e) => setImportFiles(e.target.files)}
                            className="block w-full text-sm text-foreground file:mr-3 file:rounded file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground hover:file:bg-muted/70 disabled:opacity-50"
                        />
                    </div>

                    <Button
                        size="lg"
                        variant="default"
                        onClick={handleImport}
                        disabled={isImporting || !importFiles || importFiles.length === 0}
                    >
                        {isImporting ? (
                            <span className="flex items-center gap-2">
                                <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                Importing…
                            </span>
                        ) : `Import${importFiles && importFiles.length > 0 ? ` (${importFiles.length})` : ''}`}
                    </Button>

                    {importResults.length > 0 && (
                        <div className="flex flex-col gap-1">
                            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Results ({importResults.filter((r) => r.ok).length}/{importResults.length} imported)
                            </p>
                            <div className="max-h-64 overflow-y-auto flex flex-col gap-1 rounded-md border bg-muted/40 p-2">
                                {importResults.map((r, i) => (
                                    <div key={i} className={`flex items-start gap-2 font-mono text-xs px-2 py-1 rounded border ${r.ok ? 'bg-background border-border' : 'bg-destructive/10 border-destructive/30 text-destructive'}`}>
                                        <span className="shrink-0">{r.ok ? '✓' : '✗'}</span>
                                        <span className="break-all">
                                            {r.filename}{r.error ? ` — ${r.error}` : ''}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
