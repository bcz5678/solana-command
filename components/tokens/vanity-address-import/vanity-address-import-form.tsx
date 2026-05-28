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

interface SingleResult {
    publicKey: string
    status:    'imported' | 'skipped' | 'failed'
    filename:  string
    error?:    string
}

interface BatchResult {
    imported:          number
    skipped_suffix:    number
    skipped_duplicate: number
    failed:            number
    results:           SingleResult[]
}


export default function VanityAddressImportForm() {


    const [mintStatus, setMintStatus] = useState<MintStatus>('idle')




    // --- import form state ---
    const [importFiles, setImportFiles] = useState<FileList | null>(null)
    const [importStatus, setImportStatus] = useState<ImportStatus>('idle')
    const [importResults, setImportResults] = useState<SingleResult[]>([])
    const fileInputRef = useRef<HTMLInputElement>(null)

    async function handleImport() {
        if (!importFiles || importFiles.length === 0) return

        setImportStatus('importing')
        setImportResults([])

        const results: SingleResult[] = []

        const body = new FormData()
        for (const file of Array.from(importFiles)) body.append('files', file)

        try {
            const res = await fetch('/api/vanity-keypairs/import', { method: 'POST', body })
            if (!res.ok) {
                const text = await res.text()
                results.push({ publicKey: 'unknown', filename: '(all files)', status: 'failed', error: `${res.status} ${text}` })
            } else {
                const json: BatchResult = await res.json()
                results.push(...json.results)
            }
        } catch (err) {
            results.push({ publicKey: 'unknown', filename: '(all files)', status: 'failed', error: err instanceof Error ? err.message : String(err) })
        }

        setImportResults(results)
        setImportStatus(results.every((r) => r.status === 'imported') ? 'done' : 'error')
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
                                Results ({importResults.filter((r) => r.status === 'imported').length}/{importResults.length} imported)
                            </p>
                            <div className="max-h-64 overflow-y-auto flex flex-col gap-1 rounded-md border bg-muted/40 p-2">
                                {importResults.map((r, i) => (
                                    <div key={i} className={`flex items-start gap-2 font-mono text-xs px-2 py-1 rounded border ${r.status === 'imported' ? 'bg-green-200 border-border' : 'bg-destructive/10 border-destructive/30 text-destructive'}`}>
                                        <span className="shrink-0">{r.status === 'imported' ? '✓' : '✗'}</span>
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
