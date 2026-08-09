'use client'

// ============================================================================
// Build step 11 of site-platform/docs/Form spec.md — ModulesTab, gated to
// manifest.supportsModules only (same "only what the manifest declares"
// pattern as SectionList's Add menu in build step 6).
//
// A module is "on" when content.modules[key] is present at all — enabling one
// seeds `{}` so its own required fields become visible for the first time via
// the usual SchemaField/collectFields path. token.contractAddress already had
// field() metadata; countdown.targetIso and mailingList.actionUrl didn't
// (see content.ts) — both are required with no default, so without metadata
// the module was enableable but never actually configurable. Everything else
// in SiteModulesSchema is optional-with-default and stays unannotated for now,
// same reasoning as CoreTokensSchema's un-annotated derived fields.
// ============================================================================

import { z } from 'zod'
import { SiteModulesSchema, TemplateManifest, ValidationIssue } from '@/site-platform/schema'
import { Button } from '@/components/ui/button'
import SchemaField, { collectFields, unwrap } from './schema-field'

type ModuleKey = keyof typeof SiteModulesSchema.shape

const MODULE_LABEL: Record<ModuleKey, string> = {
    token: 'Token info',
    countdown: 'Countdown',
    mailingList: 'Mailing list',
}

type Props = {
    manifest: TemplateManifest
    value: Record<string, unknown> | undefined
    onChange: (next: Record<string, unknown>) => void
    issues?: ValidationIssue[]
}

export default function ModulesTab({ manifest, value, onChange, issues }: Props) {
    const modules = value ?? {}
    const supported = manifest.supportsModules.filter(
        (key): key is ModuleKey => key in SiteModulesSchema.shape,
    )

    if (supported.length === 0) return null

    return (
        <div className="flex flex-col gap-3">
            {supported.map((key) => {
                const container = unwrap(SiteModulesSchema.shape[key])
                if (!(container instanceof z.ZodObject)) return null

                const moduleValue = modules[key] as Record<string, unknown> | undefined
                const enabled = moduleValue !== undefined
                const fields = [...collectFields(container.shape, moduleValue ?? {}).values()].flat()

                return (
                    <div key={key} className="flex flex-col gap-3 rounded-lg border border-input p-3">
                        <div className="flex items-center justify-between">
                            <h4 className="text-sm font-medium">{MODULE_LABEL[key]}</h4>
                            <Button
                                type="button" variant={enabled ? 'ghost' : 'outline'} size="sm"
                                onClick={() => onChange({ ...modules, [key]: enabled ? undefined : {} })}
                            >
                                {enabled ? 'Remove' : 'Enable'}
                            </Button>
                        </div>

                        {enabled && fields.map(({ key: fieldKey, schema }) => (
                            <SchemaField
                                key={fieldKey}
                                schema={schema}
                                value={moduleValue?.[fieldKey]}
                                onChange={(next) => onChange({
                                    ...modules,
                                    [key]: { ...moduleValue, [fieldKey]: next },
                                })}
                                path={`modules.${key}.${fieldKey}`}
                                issues={issues}
                            />
                        ))}
                    </div>
                )
            })}
        </div>
    )
}
