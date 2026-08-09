# Site builder form — build spec

The creation form. Everything it renders derives from a `TemplateManifest`; no
component may branch on a template id.

Read `CLAUDE.md` first — the invariants there constrain this whole document.

---

## API contracts

All routes use the RLS-scoped user client. Errors are `{ error: string }` plus,
where relevant, `issues: ValidationIssue[]`.

### Catalog

```
GET /api/templates
    → { templates: TemplateListEntry[], malformed?: string[] }

GET /api/templates/:templateId?version=1.0.0
    → { manifest: TemplateManifest }
```

`TemplateListEntry` carries `id`, `name`, `description`, `previewImage`,
`version`, `rendererKey`, `kind`, `manifest`.

**Always pass `version` when editing an existing site** — its pinned version,
not the latest. Loading the latest manifest against a site pinned to an older
one renders fields the site's renderer cannot handle, and publish then fails
validating against a manifest the author never saw.

Helpers in `lib/templates/client.ts`: `useTemplates()`,
`useTemplateManifest(id, version)`, `showsDesignTab()`, `showsSectionEditor()`,
`configurabilityLabel()`, `aspectFor()`.

### Draft

```
GET /api/sites/:siteId/draft
    → { site: { id, name, domain, provisioning_status,
                draft_definition, draft_template_id, draft_updated_at,
                published_version_id, published_at } }

PUT /api/sites/:siteId/draft
    { definition, templateId? }  → { savedAt: string }
```

Parsed with `.partial()` — a half-filled form saves fine.

### Preview

```
POST /api/sites/:siteId/preview
    { definition? }  → { html, issues, assetCount }
```

Lenient render. Omit `definition` to render the stored draft. Returns
`issues` rather than throwing on incomplete content.

### Media

```
POST   /api/sites/:siteId/media          multipart: file, alt
       → { asset: ImageAsset }  (201)

DELETE /api/sites/:siteId/media?assetId=…
       → { deleted: number }
```

Accepts png, jpeg, webp, avif, gif. **Not SVG** — it can carry script and would
execute on a customer domain. Max 25 MB.

Returns size variants and a 7-day signed URL. `stagingKey` is the durable
reference; re-sign on load.

### Publish

```
POST /api/sites/:siteId/publish
    { definition, templateId?, templateVersion?, note? }

    202 → { buildId, versionId, versionNumber, duplicate, warnings }
    200 → { status: "unchanged", message, warnings }
    422 → { error, issues }          content not ready
    409 → { error, detail }          site still provisioning
```

Idempotency key is generated server-side. Do not send one.

### Build status

Supabase Realtime on `private.builds`, filtered by `site_id`. Do not poll.

```ts
supabase
  .channel(`builds:${siteId}`)
  .on("postgres_changes",
      { event: "*", schema: "private", table: "builds", filter: `site_id=eq.${siteId}` },
      (payload) => setBuild(payload.new))
  .subscribe();
```

States: `queued → claimed → validating → rendering → uploading → invalidating → live`,
plus `failed` and `cancelled`. On `failed`, `error_detail` and
`validation_issues` explain why.

---

## Component tree

```
SiteBuilder                     orchestration, autosave, publish
├─ TemplatePicker               only before a template is chosen
├─ BuilderHeader                save state, validation count, Publish
├─ Tabs
│  ├─ ContentTab
│  │  ├─ MetaFields             SEO: title, description, keywords, card image
│  │  ├─ BrandFields            name, logo text, logo, favicon
│  │  ├─ HeroEditor             kicker, title, body[], background, CTAs
│  │  ├─ SectionList            reorder, add, remove, enable
│  │  │  └─ SectionEditor       per-type sub-form
│  │  ├─ SocialEditor           repeatable links
│  │  └─ FooterEditor           disclaimer, legal, links
│  ├─ DesignTab                 tokenized only
│  ├─ ModulesTab                manifest.supportsModules only
│  └─ SettingsTab               domain, noindex, locale
├─ PreviewPane                  debounced iframe
└─ BuildStatus                  Realtime progress
```

---

## Behaviour

### Autosave

Debounce 800 ms after the last change. Show `idle | saving | saved | error`.
Never block typing on a save. On error, keep retrying with backoff and warn
before navigation.

### Preview

Debounce 300 ms — heavier than autosave, so it trails it. Render into
`<iframe sandbox="allow-scripts" srcDoc={html} />`.

Keep the previous HTML visible while the next render is in flight. Blanking the
iframe on every keystroke is unusable.

### Validation

Run `validateAgainstManifest(definition.content, manifest)` client-side on
every change, and surface the server's `issues` on a 422.

- **Errors** block publish and mark the field via `issue.path`
- **Warnings** show inline, never block

Show a count in the header. Clicking it jumps to the first error.

### Section editor

Drag to reorder writes `order`, not array position. Key on `section.id`.

Constrain from the manifest:
- Add menu offers `manifest.supportedSectionTypes` only
- Add disabled at `manifest.sectionCount.max`
- Remove disabled at `manifest.sectionCount.min`
- Enable/disable toggle is a soft hide — preserves content

New sections get `crypto.randomUUID()` and `order = max + 1`. Slug is derived
by the renderer; do not compute or store one in the form.

### Media and focal point

Upload → `ImageAsset`. Focal picker is a click target over the image writing
`focalX`/`focalY` in 0..1.

Preview the crop in **pure CSS** — no server round trip:

```css
.crop { aspect-ratio: var(--target); overflow: hidden; }
.crop img {
  width: 100%; height: 100%; object-fit: cover;
  object-position: calc(var(--fx) * 100%) calc(var(--fy) * 100%);
}
```

`--target` from `aspectFor(manifest, slot)`. This is exactly the model
`computeCrop()` implements server-side, so what the author sees is what the
build produces. If they ever visibly disagree, one of the two drifted — that is
a bug, not a rounding difference.

Warn on missing alt text unless `decorative` is set.

### Design tab

Render only when `showsDesignTab(manifest)`. Fields come from:

- `manifest.usesThemeKeys` — dotted paths into `theme.core` / `theme.semantic`
- `manifest.customThemeSchema` — Tier 3, writes to `theme.templates[manifest.id]`

Widget from the declared `type`: `color` → picker, `length` → text with unit
validation, `select` → dropdown from `options`, `boolean` → toggle.

Slotted templates have both empty, so this tab does not exist for them. Say so
in the picker rather than showing an empty tab.

### Publish

1. Client-side validate; block and jump to the first error if any
2. Optional note field
3. POST, expect 202
4. Switch to build status, subscribe to Realtime
5. On `live`, link to the domain
6. On `failed`, show `error_detail`; if `validation_issues` is present, map back
   to fields

Handle `status: "unchanged"` — the definition matched the live version, and
there is no build to watch.

---

## Field generation from schema metadata

The mechanism that keeps the form free of per-template code.

```ts
import { getFieldMeta } from "@site/schema";

const meta = getFieldMeta(SiteMetaSchema.shape.title);
// { label: "Page title", widget: "text", group: "SEO", order: 2 }
```

`FieldMeta` carries `label`, `help`, `placeholder`, `widget`, `group`, `order`,
`options`, `visibleWhen`, `advanced`.

Build one `<SchemaField>` that maps `widget` to a component. Adding a field to
the schema should make it appear with no form-code change. **If you find
yourself writing a hardcoded field, the metadata layer is missing an
expressive capability — extend `FieldMeta` rather than branching.**

Group fields by `group`, sort by `order`, collapse `advanced` behind a
disclosure, and hide when `visibleWhen` does not match.

---

## Build order

Each step is independently testable. Do not skip ahead — later steps depend on
earlier ones being right.

**1. Data layer** — `useSiteDraft(siteId)`: load, local state, debounced
autosave, save status. No UI beyond a textarea proving round trip.

**2. Template picker** — `useTemplates()`, cards with preview image, name,
`configurabilityLabel()`. Selecting sets `templateId` and `templateVersion` and
seeds an empty definition.

**3. SchemaField** — the widget mapper. Prove it on `MetaFields`, which is flat
and has no repeaters.

**4. Hero editor** — introduces `body[]` repeater and the CTA sub-form.

**5. Media** — upload, focal picker, CSS crop preview. Wire into the hero
background first.

**6. Section list** — reorder, add/remove, enable, manifest constraints. Then
`SectionEditor` per type, starting with `prose`.

**7. Preview pane** — debounced iframe. Everything before this is verifiable
without it; this is where it becomes usable.

**8. Validation** — client-side issues, field marking, header count.

**9. Design tab** — manifest-driven, tokenized only.

**10. Publish and status** — POST, Realtime subscription, progress, error
handling.

**11. Modules and settings** — token, countdown, mailing list; domain, noindex.

---

## Anti-patterns

**Branching on template id.** If the form needs to know something, it goes in
the manifest.

**Keying React lists on array index.** Reordering reassigns identity and React
reuses the wrong DOM nodes — uploaded images end up on the wrong section.

**Computing slugs in the form.** `assignSlugs()` runs in the renderer, dedupes
across the whole list, and handles labels that slugify to nothing. A form-side
slug will disagree.

**A parallel type mirroring a Zod schema.** Import `z.infer` types.

**Blocking typing on autosave or preview.** Both are debounced and
non-blocking. The form is usable while they are in flight.

**A "sections" array in component state separate from the definition.** One
source of truth: the definition object. Derive everything else.

**Blanking the preview on every keystroke.** Keep the last good HTML until the
next render returns.

---

## Test cases

- 90-character title, empty description
- Two sections both named "About" — slugs must differ in the preview
- Emoji-only nav label — must not produce an empty anchor
- `sectionCount.max` reached — Add disabled with an explanation
- Slotted template — no Design tab, section editor constrained or absent
- Image with no alt text — warning, not a block
- Publish with a missing required field — 422, field marked, first error focused
- Publish twice quickly — second returns `duplicate: true`, no second build
- Publish with no changes — `status: "unchanged"`, no build
- Site still provisioning — 409 with a clear message
- Build fails mid-render — `error_detail` shown, publish available again