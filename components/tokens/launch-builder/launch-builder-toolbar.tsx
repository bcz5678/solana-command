'use client'

import { useState, useEffect } from 'react'
import {
    Braces, Check, Copy, Save, FolderOpen, Bookmark, BookOpen, Loader2,
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
import type {
    SavedLaunchConfig,
    SavedLaunchConfigSummary,
    LaunchTemplate,
    LaunchTemplateSummary,
} from '@/lib/types/launch-builder'

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

    const [configs, setConfigs]             = useState<SavedLaunchConfigSummary[]>([])
    const [loadingConfigs, setLoadingConfigs] = useState(false)

    const [templates, setTemplates]           = useState<LaunchTemplateSummary[]>([])
    const [loadingTemplates, setLoadingTemplates] = useState(false)

    const json = JSON.stringify(profile, null, 2)

    useEffect(() => {
        if (!loadOpen) return
        setLoadingConfigs(true)
        fetch('/api/launch-builder/config/list')
            .then((r) => r.json())
            .then((d) => setConfigs(Array.isArray(d) ? d : []))
            .catch(() => setConfigs([]))
            .finally(() => setLoadingConfigs(false))
    }, [loadOpen])

    useEffect(() => {
        if (!templatesOpen) return
        setLoadingTemplates(true)
        fetch('/api/launch-builder/template/list')
            .then((r) => r.json())
            .then((d) => setTemplates(Array.isArray(d) ? d : []))
            .catch(() => setTemplates([]))
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

    async function handleLoadConfig(id: string) {
        setApplyingId(id)
        try {
            const res = await fetch(`/api/launch-builder/config/load?id=${id}`)
            if (!res.ok) return
            const config = (await res.json()) as SavedLaunchConfig
            onLoadProfile(config.graph, config.name)
            setLoadOpen(false)
        } finally {
            setApplyingId(null)
        }
    }

    async function handleApplyTemplate(id: string) {
        setApplyingId(id)
        try {
            const res = await fetch(`/api/launch-builder/template/load?id=${id}`)
            if (!res.ok) return
            const tpl = (await res.json()) as LaunchTemplate
            onLoadProfile(tpl.graph, tpl.name)
            setTemplatesOpen(false)
        } finally {
            setApplyingId(null)
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
                    {tplSaveState === 'saved'
                        ? 'Saved!'
                        : tplSaveState === 'error'
                          ? 'Error'
                          : 'Save Template'}
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
                    {saveState === 'saved'
                        ? 'Saved!'
                        : saveState === 'error'
                          ? 'Error'
                          : 'Save'}
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
                                        <Badge variant="outline" className="text-[10px]">
                                            {cfg.status}
                                        </Badge>
                                        <Button
                                            size="sm"
                                            disabled={applyingId === cfg.id}
                                            onClick={() => handleLoadConfig(cfg.id)}
                                        >
                                            {applyingId === cfg.id && (
                                                <Loader2 className="mr-1 size-3.5 animate-spin" />
                                            )}
                                            Load
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
                                            onClick={() => handleApplyTemplate(tpl.id)}
                                        >
                                            {applyingId === tpl.id && (
                                                <Loader2 className="mr-1 size-3.5 animate-spin" />
                                            )}
                                            Use
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
