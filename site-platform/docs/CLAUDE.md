# CLAUDE.md — site platform

Context for the site generation subsystem. Read before touching anything under
`src/site-platform/`, `app/api/sites/`, `app/api/internal/`, or `app/api/templates/`.

This is a subsystem inside a larger app. It generates static one-page sites from
a form, deploys them to S3 + CloudFront on customer domains, and is orchestrated
through n8n.

---

## The one-paragraph version

A user fills a form. The form's shape is derived from a **template manifest**
stored in the database. On publish, the definition is snapshotted immutably, a
build is queued, Next.js claims and renders it to HTML, and n8n does the AWS
work. Adding a new template is a manifest row plus a render function — no
changes to the form, the API, the SQL, or n8n.

---

## Invariants

Breaking any of these breaks the system in a way that is expensive to unwind.
If a task seems to require it, the task is wrong — say so rather than working
around it.

### 1. The manifest drives everything

No component may branch on a template id. If the form needs to know something
about a template, that something belongs in `TemplateManifest`.

```ts
if (templateId === "hero-onepager") { ... }        // ✗ never
if (manifest.capabilities?.hasMobileDrawer) { ... } // ✓
```

`kind`, `supportedSectionTypes`, `sectionCount`, `requiredContent`,
`usesThemeKeys`, `customThemeSchema`, `imageAspect` and `capabilities` exist
precisely so this rule holds.

### 2. Zod is the single source of truth

Schemas live in `src/site-platform/schema/`. Types are `z.infer`, never
hand-written. Do not create a parallel interface that mirrors a schema — it
will drift within weeks.

Form field metadata is attached with `field(schema, meta)` and read back with
`getFieldMeta`. `field()` must be **outermost** in a chain: registry keys are
object identity, and `.optional()` returns a new instance.

```ts
field(z.string().optional(), meta)   // ✓
field(z.string(), meta).optional()   // ✗ metadata silently lost
```

### 3. The renderer is pure

`src/site-platform/renderer/` has no filesystem, network, or database access.
It takes a definition and returns a string. That is what makes the form's live
preview structurally incapable of drifting from production output.

If a render path needs data, the caller fetches it and passes it in.

### 4. Section identity vs sequence

`section.id` is a UUID assigned at creation and never changes. `section.order`
is an integer. **Array position is neither** — it is a rendering detail.

Reordering writes `order`. Never key React lists on index; use `section.id`.

`section.slug` is derived from `navLabel` via `assignSlugs()` and deduped. Never
authored, never edited directly.

### 5. Immutable published versions

`private.site_versions` rows cannot be updated or deleted — a database trigger
enforces it. Publishing edits creates a new version. Same for
`template_versions` and `vendor_package_versions`.

If an upsert raises "differs from the committed version", that is the guard
working. Bump the version; do not loosen the trigger.

### 6. Private schema, public wrappers

`private` is not PostgREST-reachable. Everything goes through a
`SECURITY DEFINER` wrapper in `public`.

Every wrapper checks `private.super_admins` directly, via
`private.is_super_admin_db()`. **Never `public.is_super_admin()`** — that reads
JWT `app_metadata`, which is stripped inside `SECURITY DEFINER` and always
returns false there.

### 7. Which Supabase client

| Context | Client | Why |
|---|---|---|
| `app/api/sites/*` | RLS-scoped user client from `@/lib/supabase/server` | wrappers call `auth.uid()` |
| `app/api/templates/*` | RLS-scoped user client | `list_templates` is granted to `authenticated` |
| `lib/internal/*` | service role via `adminClient()` | orchestrator functions granted to `service_role` only |

Passing a service-role client to `publish_site` makes `auth.uid()` null, the
ownership check fails closed, and every publish returns "not owned by caller".

---

## Layout

```
src/site-platform/
├─ schema/          Zod schemas — the contract
└─ renderer/        pure render path
   ├─ render.ts     dispatcher; branches on manifest.kind
   ├─ document.ts   doctype, meta/OG, @layer, tokens, script hashing
   ├─ theme.ts      three-tier token resolution -> CSS variables
   ├─ assets.ts     media planning, content hashing, cache headers
   ├─ escape.ts     esc / escAttr / safeUrl / cssValue
   ├─ vendor.ts     dependency resolution, CSP assembly
   ├─ slotted/      imported-bundle render path
   └─ templates/    one directory per template

lib/internal/       server-only: guard.ts, render.ts, crop.ts
app/api/
├─ templates/       catalog (user JWT)
├─ sites/[siteId]/  draft, publish, preview, media (user JWT)
└─ internal/        dispatch, status, render, media/derive (shared secret)

supabase/migrations/
scripts/            sync-manifests, seed-vendor, import-bundle
```

ESLint enforces that nothing under `src/site-platform/` imports from `@/lib`,
`@/app` or `@/components`. It talks to the outside only through exported types.

---

## Two kinds of template

**`tokenized`** — a render function in the `TEMPLATES` registry. Full theme
control, arbitrary section counts, every byte generated by us.

**`slotted`** — an imported published site, kept structurally intact, with
content swapped in by CSS selector. Look is fixed. `usesThemeKeys` and
`customThemeSchema` **must be empty** (the schema enforces it), so the form
shows no Design tab.

Slotted is the default for acquired bundles: 30–60 minutes to import versus
4–8 hours to tokenize.

---

## Build pipeline

```
publish_site()  →  queued
dispatch        →  claimed → validating → rendering   (Next.js reports)
n8n             →  uploading → invalidating → live    (n8n reports)
```

- The queue is the durability layer. A lost dispatch call is recovered by a
  sweep within three minutes.
- `builds_one_active_per_site` (partial unique index) prevents concurrent
  writes to one S3 prefix.
- `reap_stale_builds()` runs in pg_cron every five minutes — it exists because
  that index would otherwise wedge a site forever if n8n died mid-build.
- Every status report refreshes `heartbeat_at`; phase transitions are the
  liveness signal.
- n8n holds **no database credential**. It receives opaque keys and posts them
  back to `/api/internal/*`.

---

## Three asset classes

| Class | Staged | Published | Transformed |
|---|---|---|---|
| Vendor (fonts, glyphs) | `_vendor/{pkg}@{ver}/` | `CopyObject` | No |
| Bundle (slotted CSS/JS/img) | `_templates/{id}@{ver}/` | `CopyObject` | No |
| User media | Supabase Storage | `/api/internal/media/derive` | Yes |

Vendor and bundle assets are uploaded at deploy time by `seed-vendor.ts` and
`import-bundle.ts` — **never at build time**. The build only copies from
prefixes that already exist.

One S3 bucket, prefix per site. Not bucket per site.

Media lifecycle: size variants at upload (focal-independent), crops at publish
(focal-dependent), preview via pure CSS `object-position`. That split is why
moving the focal point costs nothing.

---

## Gotchas

**`.default({})` on a Zod object** types against the *input* type. Inner fields
need `.optional().default(...)` for `{}` to be valid input.

**Zod registry generics** — `schema.register(reg, meta)` fails against an
unresolved generic. Cast to the concrete type inside the helper:
`fieldRegistry.add(schema as z.ZodType, meta)`.

**`FieldMeta` must be a `type`, not an `interface`** — interfaces lack an
implicit index signature and fail Zod's registry constraint.

**Supabase query builders are thenables, not Promises.** `.catch()` does not
exist. Use try/catch, or `Promise.resolve(builder).catch()`.

**Route files may only export HTTP verbs plus config.** Shared functions go in
`lib/`.

**`noUncheckedIndexedAccess` is on.** Array indexing yields `T | undefined`.

**Signed Supabase Storage URLs expire (7 days).** The storage KEY is the durable
reference stored in the definition; re-sign on load.

**The draft route does a shape guard, not a schema parse.** `PUT
/api/sites/:siteId/draft` checks the payload against `DraftGuard` — a
`.passthrough()` object validating only top-level key types, plus a 2MB size
cap — never `SiteDefinitionSchema`. `SiteDefinitionSchema.partial()` is only
shallow (`content` becomes optional but its own required keys do not, so a
form with only `meta.title` filled in would fail every keystroke), and a
deeply-partial mirror of `SiteContentSchema` would be a second schema that
drifts from the first. Content completeness is publish's job, via
`validateAgainstManifest`.

---

## Commands

```bash
pnpm -r typecheck
pnpm vitest run                    # renderer snapshot + invariants
pnpm vitest run -u                 # update snapshot — READ THE DIFF FIRST

pnpm tsx scripts/sync-manifests.ts --check    # CI: manifests vs database
pnpm tsx scripts/sync-manifests.ts            # apply
pnpm tsx scripts/seed-vendor.ts vendor/inter
pnpm tsx scripts/import-bundle.ts templates/neon-launch --version 1.0.0
```

The renderer test suite asserts invariants that must hold for every template:
nav hrefs resolve to real ids, no duplicate ids, user content escaped,
`javascript:` neutralised, no inline event handlers, no literal colours in
stylesheets. Do not weaken these to make a change pass.

---

## When something seems to need a workaround

The usual cause is one of:

- Wanting to branch on a template id → the manifest is missing a field
- Wanting to edit a committed version → bump the version
- Wanting the renderer to fetch something → pass it in from the caller
- Wanting service role in a user route → the wrapper needs `auth.uid()`

Raise it rather than working around it. These constraints are load-bearing.