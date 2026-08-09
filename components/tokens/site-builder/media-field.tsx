'use client'

// ============================================================================
// Build step 5 of site-platform/docs/Form spec.md — upload, focal picker, CSS
// crop preview. Wired into the hero background first, per the build order.
//
// Not a SchemaField widget: `backgroundImage` is a nested ImageAsset object,
// not a scalar, so it gets its own bespoke editor — same reasoning as
// CtaEditor. `alt` and `decorative` are still ordinary SchemaField/field()
// widgets underneath (see ImageAssetSchema), so adding a leaf field to that
// schema still needs no change here.
//
// The crop preview below is the client-side twin of computeCrop() in
// lib/internal/crop.ts (used at publish, and by app/api/internal/media/derive)
// — same aspect-ratio + object-position math, so what the author sees here is
// what the build produces. If they ever visibly disagree, one of the two
// drifted; that's a bug, not a rounding difference.
// ============================================================================

import { useRef, useState } from 'react'
import { Upload, X } from 'lucide-react'
import { ImageAsset, ImageAssetSchema, TemplateManifest, ValidationIssue } from '@/site-platform/schema'
import { aspectFor } from '@/lib/templates/client'
import { uploadSiteMedia, deleteSiteMedia } from '@/lib/sites/client'
import { Button } from '@/components/ui/button'
import SchemaField from './schema-field'

const ACCEPT = 'image/png,image/jpeg,image/webp,image/avif,image/gif'

type Props = {
    siteId: string
    slot: 'hero' | 'section' | 'card' | 'gallery'
    manifest: TemplateManifest | null
    value: ImageAsset | undefined
    onChange: (next: ImageAsset | undefined) => void
    /** Build step 8 — e.g. "hero.backgroundImage"; `${path}.alt` is where validateAgainstManifest's missing-alt warning lands. */
    path?: string
    issues?: ValidationIssue[]
}

function clamp01(n: number): number {
    return Math.min(1, Math.max(0, n))
}

export default function MediaField({ siteId, slot, manifest, value, onChange, path, issues }: Props) {
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [uploading, setUploading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const aspect = manifest ? aspectFor(manifest, slot) : '16/9'

    async function onFileSelected(file: File) {
        setUploading(true)
        setError(null)
        try {
            onChange(await uploadSiteMedia(siteId, file, value?.alt ?? ''))
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setUploading(false)
            if (fileInputRef.current) fileInputRef.current.value = ''
        }
    }

    async function onRemove() {
        if (!value) return
        try {
            await deleteSiteMedia(siteId, value.id)
        } catch (err) {
            // Best-effort — the reference still clears locally so the form isn't
            // stuck on a storage hiccup. orphaned_media_paths() is the backstop.
            console.error('[media] delete failed:', err)
        }
        onChange(undefined)
    }

    function onFocalClick(e: React.MouseEvent<HTMLImageElement>) {
        if (!value) return
        const rect = e.currentTarget.getBoundingClientRect()
        onChange({
            ...value,
            focalX: clamp01((e.clientX - rect.left) / rect.width),
            focalY: clamp01((e.clientY - rect.top) / rect.height),
        })
    }

    return (
        <div className="flex flex-col gap-3">
            <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) onFileSelected(file)
                }}
            />

            {!value ? (
                <Button
                    type="button" variant="outline" size="sm" className="w-fit"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                >
                    <Upload /> {uploading ? 'Uploading…' : 'Upload image'}
                </Button>
            ) : (
                <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-start gap-4">
                        <div className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">Click to set focal point</span>
                            <div className="relative w-fit">
                                <img
                                    src={value.url}
                                    alt={value.alt}
                                    onClick={onFocalClick}
                                    className="max-h-64 w-auto cursor-crosshair rounded-md ring-1 ring-foreground/10"
                                />
                                <div
                                    className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-blue-500 shadow"
                                    style={{ left: `${value.focalX * 100}%`, top: `${value.focalY * 100}%` }}
                                />
                            </div>
                        </div>

                        <div className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">Crop preview ({aspect})</span>
                            <div className="w-40 overflow-hidden rounded-md ring-1 ring-foreground/10" style={{ aspectRatio: aspect }}>
                                <img
                                    src={value.url}
                                    alt=""
                                    className="size-full object-cover"
                                    style={{ objectPosition: `${value.focalX * 100}% ${value.focalY * 100}%` }}
                                />
                            </div>
                        </div>
                    </div>

                    <SchemaField
                        schema={ImageAssetSchema.shape.alt}
                        value={value.alt}
                        onChange={(next) => onChange({ ...value, alt: next as string })}
                        path={path ? `${path}.alt` : undefined}
                        issues={issues}
                    />
                    <SchemaField
                        schema={ImageAssetSchema.shape.decorative}
                        value={value.decorative}
                        onChange={(next) => onChange({ ...value, decorative: next as boolean })}
                    />

                    <Button type="button" variant="ghost" size="sm" className="w-fit" onClick={onRemove}>
                        <X /> Remove image
                    </Button>
                </div>
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
    )
}
