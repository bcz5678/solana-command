'use client'

import { useState, useEffect } from 'react'
import {
    Braces, Check, Copy, Save, FolderOpen, Bookmark, BookOpen, Loader2, Trash2,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog'
import type { LaunchProfile } from './launch-profile'
import type { SavedLaunchConfig, LaunchTemplate } from '@/lib/types/launch-builder'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

type Props = {
    profileName: string
    onProfileNameChange: (name: string) => void
    profile: LaunchProfile
    onSave: () => Promise<string | null>
    onSaveAsTemplate: () => Promise<boolean>
    onLoadProfile: (profile: LaunchProfile, name: string) => void
}

export default function LaunchBuilderToolbar({
    profileName,
    onProfileNameChange,
    profile,
    onSave,
    onSaveAsTemplate,
    onLoadProfile,
}: Props) {
    const [jsonOpen, setJsonOpen]           = useState(false)
    const [copied, setCopied]               = useState(false)
    const [loadOpen, setLoadOpen]           = useState(false)
    const [templatesOpen, setTemplatesOpen] = useState(false)
    const [saveState, setSaveState]         = useState<SaveState>('idle')
    const [tplSaveState, setTplSaveState]   = useState<SaveState>('idle')
    const [applyingId, setApplyingId]       = useState<string | null>(null)
    const [deletingId, setDeletingId]       = useState<string | null>(null)

    // Full objects — graph is included so "Use" doesn't need a second fetch
    const [configs, setConfigs]               = useState<SavedLaunchConfig[]>([])
    const [loadingConfigs, setLoadingConfigs]  = useState(false)
    const [configsError, setConfigsError]     = useState<string | null>(null)

    const [templates, setTemplates]             = useState<LaunchTemplate[]>([])
    const [loadingTemplates, setLoadingTemplates] = useState(false)
    const [templatesError, setTemplatesError]   = useState<string | null>(null)

    const json = JSON.stringify(profile, null, 2)

    useEffect(() => {
        if (!loadOpen) return
        setLoadingConfigs(true)
        setConfigsError(null)
        fetch('/api/launch-builder/config/list')
            .then(async (r) => {
                const d = await r.json()
                if (!r.ok) {
                    setConfigsError(d?.error ?? `HTTP ${r.status}`)
                    setConfigs([])
                } else {
                    setConfigs(Array.isArray(d) ? d : [])
                }
            })
            .catch((e) => { setConfigsError(String(e)); setConfigs([]) })
            .finally(() => setLoadingConfigs(false))
    }, [loadOpen])

    useEffect(() => {
        if (!templatesOpen) return
        setLoadingTemplates(true)
        setTemplatesError(null)
        fetch('/api/launch-builder/template/list')
            .then(async (r) => {
                const d = await r.json()
                if (!r.ok) {
                    setTemplatesError(d?.error ?? `HTTP ${r.status}`)
                    setTemplates([])
                } else {
                    setTemplates(Array.isArray(d) ? d : [])
                }
            })
            .catch((e) => { setTemplatesError(String(e)); setTemplates([]) })
            .finally(() => setLoadingTemplates(false))
    }, [templatesOpen])

    function copyJson() {
        navigator.clipboard.writeText(json)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
    }

    async function handleSave() {
        setSaveState('saving')
        const id = await onSave()
        setSaveState(id ? 'saved' : 'error')
        setTimeout(() => setSaveState('idle'), 2000)
    }

    async function handleSaveAsTemplate() {
        setTplSaveState('saving')
        const ok = await onSaveAsTemplate()
        setTplSaveState(ok ? 'saved' : 'error')
        setTimeout(() => setTplSaveState('idle'), 2000)
    }

    async function handleLoadConfig(cfg: SavedLaunchConfig) {
        setApplyingId(cfg.id)
        try {
            // Full object already loaded — fetch only if graph is missing
            if (cfg.graph) {
                onLoadProfile(cfg.graph, cfg.name)
                setLoadOpen(false)
                return
            }
            const res = await fetch(`/api/launch-builder/config/load?id=${cfg.id}`)
            if (!res.ok) return
            const full = (await res.json()) as SavedLaunchConfig
            onLoadProfile(full.graph, full.name)
            setLoadOpen(false)
        } finally {
            setApplyingId(null)
        }
    }

    async function handleDeleteConfig(id: string) {
        if (!window.confirm('Delete this config? This cannot be undone.')) return
        setDeletingId(id)
        try {
            await fetch(`/api/launch-builder/config/delete?id=${id}`, { method: 'DELETE' })
            setConfigs((prev) => prev.filter((c) => c.id !== id))
        } finally {
            setDeletingId(null)
        }
    }

    async function handleApplyTemplate(tpl: LaunchTemplate) {
        setApplyingId(tpl.id)
        try {
            // Graph included in list response — no second fetch needed
            if (tpl.graph) {
                onLoadProfile(tpl.graph, tpl.name)
                setTemplatesOpen(false)
                return
            }
            const res = await fetch(`/api/launch-builder/template/load?id=${tpl.id}`)
            if (!res.ok) return
            const full = (await res.json()) as LaunchTemplate
            onLoadProfile(full.graph, full.name)
            setTemplatesOpen(false)
        } finally {
            setApplyingId(null)
        }
    }

    async function handleDeleteTemplate(id: string) {
        if (!window.confirm('Delete this template? This cannot be undone.')) return
        setDeletingId(id)
        try {
            await fetch(`/api/launch-builder/template/delete?id=${id}`, { method: 'DELETE' })
            setTemplates((prev) => prev.filter((t) => t.id !== id))
        } finally {
            setDeletingId(null)
        }
    }

    return (
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card/40 px-3">
            <Input
                value={profileName}
                onChange={(e) => onProfileNameChange(e.target.value)}
                placeholder="Untitled Launch"
                className="h-8 w-64"
            />
            <span className="text-[11px] text-muted-foreground">
                {profile.nodes.length} node{profile.nodes.length !== 1 ? 's' : ''} ·{' '}
                {profile.edges.length} connection{profile.edges.length !== 1 ? 's' : ''}
            </span>

            <div className="ml-auto flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setTemplatesOpen(true)}>
                    <BookOpen className="size-3.5" />
                    Templates
                </Button>

                <Button variant="ghost" size="sm" onClick={() => setLoadOpen(true)}>
                    <FolderOpen className="size-3.5" />
                    Load
                </Button>

                <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSaveAsTemplate}
                    disabled={tplSaveState === 'saving'}
                >
                    {tplSaveState === 'saving' ? (
                        <Loader2 className="size-3.5 animate-spin" />
                    ) : tplSaveState === 'saved' ? (
                        <Check className="size-3.5" />
                    ) : (
                        <Bookmark className="size-3.5" />
                    )}
                    {tplSaveState === 'saved' ? 'Saved!' : tplSaveState === 'error' ? 'Error' : 'Save Template'}
                </Button>

                <Button
                    variant="default"
                    size="sm"
                    onClick={handleSave}
                    disabled={saveState === 'saving'}
                >
                    {saveState === 'saving' ? (
                        <Loader2 className="size-3.5 animate-spin" />
                    ) : saveState === 'saved' ? (
                        <Check className="size-3.5" />
                    ) : (
                        <Save className="size-3.5" />
                    )}
                    {saveState === 'saved' ? 'Saved!' : saveState === 'error' ? 'Error' : 'Save'}
                </Button>

                <Button variant="outline" size="sm" onClick={() => setJsonOpen(true)}>
                    <Braces className="size-3.5" />
                    JSON
                </Button>
            </div>

            {/* ── JSON viewer ─────────────────────────────────────────────── */}
            <Dialog open={jsonOpen} onOpenChange={setJsonOpen}>
                <DialogContent className="sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Launch Profile JSON</DialogTitle>
                        <DialogDescription>
                            Live snapshot — updates as you edit. This is the object sent to the save API.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="relative">
                        <pre className="max-h-[55vh] overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-[11px] leading-relaxed">
                            {json}
                        </pre>
                        <Button
                            variant="outline"
                            size="icon-sm"
                            onClick={copyJson}
                            title="Copy JSON"
                            className="absolute top-2 right-2"
                        >
                            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* ── Load saved config ────────────────────────────────────────── */}
            <Dialog open={loadOpen} onOpenChange={setLoadOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Load Saved Config</DialogTitle>
                        <DialogDescription>
                            Select a previously saved launch configuration to restore to the canvas.
                        </DialogDescription>
                    </DialogHeader>
                    {loadingConfigs ? (
                        <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                            <Loader2 className="mr-2 size-4 animate-spin" /> Loading…
                        </div>
                    ) : configsError ? (
                        <p className="py-4 text-center text-sm text-destructive">
                            Failed to load configs: {configsError}
                        </p>
                    ) : configs.length === 0 ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">
                            No saved configs yet. Use Save to create one.
                        </p>
                    ) : (
                        <div className="flex max-h-80 flex-col gap-1.5 overflow-y-auto pr-1">
                            {configs.map((cfg) => (
                                <div
                                    key={cfg.id}
                                    className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5"
                                >
                                    <div className="flex min-w-0 flex-1 flex-col">
                                        <span className="truncate text-sm font-medium">{cfg.name}</span>
                                        <span className="text-xs text-muted-foreground">
                                            {new Date(cfg.updated_at).toLocaleString()}
                                        </span>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                        {cfg.status && (
                                            <Badge variant="outline" className="text-[10px]">
                                                {cfg.status}
                                            </Badge>
                                        )}
                                        <Button
                                            size="sm"
                                            disabled={applyingId === cfg.id}
                                            onClick={() => handleLoadConfig(cfg)}
                                        >
                                            {applyingId === cfg.id && (
                                                <Loader2 className="mr-1 size-3.5 animate-spin" />
                                            )}
                                            Load
                                        </Button>
                                        <Button
                                            size="icon-sm"
                                            variant="ghost"
                                            disabled={deletingId === cfg.id}
                                            onClick={() => handleDeleteConfig(cfg.id)}
                                            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                        >
                                            {deletingId === cfg.id ? (
                                                <Loader2 className="size-3.5 animate-spin" />
                                            ) : (
                                                <Trash2 className="size-3.5" />
                                            )}
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* ── Templates picker ─────────────────────────────────────────── */}
            <Dialog open={templatesOpen} onOpenChange={setTemplatesOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Templates</DialogTitle>
                        <DialogDescription>
                            Start from a saved template. Unsaved canvas work will be replaced.
                        </DialogDescription>
                    </DialogHeader>
                    {loadingTemplates ? (
                        <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                            <Loader2 className="mr-2 size-4 animate-spin" /> Loading…
                        </div>
                    ) : templatesError ? (
                        <p className="py-4 text-center text-sm text-destructive">
                            Failed to load templates: {templatesError}
                        </p>
                    ) : templates.length === 0 ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">
                            No templates yet. Use &quot;Save Template&quot; to create one.
                        </p>
                    ) : (
                        <div className="flex max-h-80 flex-col gap-1.5 overflow-y-auto pr-1">
                            {templates.map((tpl) => (
                                <div
                                    key={tpl.id}
                                    className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5"
                                >
                                    <div className="flex min-w-0 flex-1 flex-col">
                                        <div className="flex items-center gap-2">
                                            <span className="truncate text-sm font-medium">{tpl.name}</span>
                                            {tpl.is_shared && (
                                                <Badge variant="secondary" className="text-[10px]">
                                                    Shared
                                                </Badge>
                                            )}
                                        </div>
                                        {tpl.description && (
                                            <span className="truncate text-xs text-muted-foreground">
                                                {tpl.description}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                        <span className="text-[10px] text-muted-foreground">
                                            {tpl.use_count}×
                                        </span>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={applyingId === tpl.id}
                                            onClick={() => handleApplyTemplate(tpl)}
                                        >
                                            {applyingId === tpl.id && (
                                                <Loader2 className="mr-1 size-3.5 animate-spin" />
                                            )}
                                            Use
                                        </Button>
                                        <Button
                                            size="icon-sm"
                                            variant="ghost"
                                            disabled={deletingId === tpl.id}
                                            onClick={() => handleDeleteTemplate(tpl.id)}
                                            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                        >
                                            {deletingId === tpl.id ? (
                                                <Loader2 className="size-3.5 animate-spin" />
                                            ) : (
                                                <Trash2 className="size-3.5" />
                                            )}
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    )
}
