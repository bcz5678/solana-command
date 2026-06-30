'use client'

import { useState } from 'react'
import { Braces, Check, Copy } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog'
import { LaunchProfile } from './launch-profile'

type Props = {
    profileName: string
    onProfileNameChange: (name: string) => void
    profile: LaunchProfile
}

export default function LaunchBuilderToolbar({ profileName, onProfileNameChange, profile }: Props) {
    const [jsonOpen, setJsonOpen] = useState(false)
    const [copied, setCopied] = useState(false)

    const json = JSON.stringify(profile, null, 2)

    function copyJson() {
        navigator.clipboard.writeText(json)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
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
                {profile.nodes.length} node{profile.nodes.length !== 1 ? 's' : ''} · {profile.edges.length} connection{profile.edges.length !== 1 ? 's' : ''}
            </span>

            <div className="ml-auto">
                <Button variant="outline" size="sm" onClick={() => setJsonOpen(true)}>
                    <Braces className="size-3.5" />
                    View JSON
                </Button>
            </div>

            <Dialog open={jsonOpen} onOpenChange={setJsonOpen}>
                <DialogContent className="sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Launch Profile JSON</DialogTitle>
                        <DialogDescription>
                            Live snapshot of the canvas — updates automatically as you add, configure, connect, or remove nodes.
                            Save/load against the database isn&apos;t wired up yet; this is the object that will be sent.
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
        </div>
    )
}
