# Audit response — corrections and next steps

The audit is accurate. Three things to correct or clarify before the rewire.

---

## 1. My documentation error: who creates the S3 folder

`PROVISIONING_ARCHITECTURE.md` and `WIZARD_INTEGRATION.md` both say the wizard
creates the S3 folder. **Wrong.** The setup workflow's `s3_folder` step does it
— `Create a site base folder` → `Upload index.html placeholder`.

What the wizard must do is **derive and record the name**. `s3_prefix` is a
string on the site row; the folder it names comes into existence during
provisioning.

That is why `start_domain_setup` raises when `s3_prefix` is null: not because
the folder must already exist, but because the workflow needs telling where to
put it, and a defaulted prefix would point CloudFront's origin path at a folder
nothing else agrees on.

**Doc edits:**

```diff
- `s3_prefix` is **wizard output** — the folder is created before setup runs,
- and the `{SYMBOL}_{CA[0:7]}/` naming scheme is the wizard's.
+ `s3_prefix` is **wizard output** — the wizard derives and records the NAME via
+ create_site(). The folder itself is created by the setup workflow's s3_folder
+ step. Nothing in the app makes an S3 call during site creation.
```

```diff
- 2. s3_prefix set          ← wizard creates the S3 folder; API will not invent one
+ 2. Site created           ← POST /api/sites; derives and records s3_prefix
```

This makes the blocking gap smaller than the audit concluded — there is no S3
integration to build, only a row to insert.

## 2. `startSetup()` default — confirmed bug

```diff
  export async function startSetup(
    siteId: string,
    distributionId: string,
    distributionUrl: string,
-   domainSource: ProvisioningRun["domainSource"] = "purchase",
+   /**
+    * Only supply alongside a domain, when selecting for the first time.
+    * sites.domain_source is authoritative once recorded — sending it
+    * unconditionally can contradict what select_domain wrote.
+    */
+   domainSource?: ProvisioningRun["domainSource"],
+   domain?: string,
  ) {
-   return post(siteId, { kind: "setup", distributionId, distributionUrl, domainSource });
+   return post(siteId, {
+     kind: "setup", distributionId, distributionUrl,
+     ...(domain ? { domain } : {}),
+     ...(domainSource ? { domainSource } : {}),
+   });
  }
```

Add a `selectDomain` fetcher while you are in the file:

```ts
export async function selectDomain(
  siteId: string,
  domain: string,
  domainSource: "in_account" | "external" = "in_account",
  detail?: Record<string, unknown>,
) {
  const res = await fetch(`/api/sites/${siteId}/domain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ domain, domainSource, detail }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Failed to select domain (${res.status})`);
  return json as { site_id: string; domain: string; domainSource: string; reclaimed: boolean };
}
```

## 3. The legacy `/api/domains/*` stack

Not all of it is legacy. Split it.

| Route | Verdict |
|---|---|
| `GET /api/domains/search` | **Keep** — live Namecheap lookup. Add app-step recording. |
| `GET /api/domains/verify` | **Keep** — live account check. Add app-step recording. |
| `GET /api/domains/distributions` | **Keep as-is** — live AWS, exactly right. |
| `POST /api/domains/setup` | **Delete** — superseded |
| `GET /api/domains/setup/status` | **Delete** — superseded |
| `lib/domains/setup-jobs.ts` | **Delete** — in-memory Map, no durability |
| `POST /api/domains/purchase` | **Delete** — superseded, and it has no `started`-before-call guard |

The three that stay are doing something the new stack does not: live external
lookups. They just need to also record what they found.

### App-step recording

`domain_search` and `domain_check_account` go through
`record_provisioning_app_step`, which requires a `run_id`. That is awkward for a
search that happens *before* any run exists.

Two options:

**A. Record them retroactively.** The wizard holds search and check results in
local state, and `select_domain` or `start_domain_purchase` writes them as
events once a run exists. Faithful timeline, slightly more plumbing.

**B. Fold the result into `select_domain`'s `p_detail`.** Already a parameter,
currently unused. Loses the separate timeline rows but keeps the evidence.

I would take **B** for now. The timeline value is "why was purchase skipped,"
and `domain_source: 'in_account'` plus the detail payload answers that. Revisit
if you want per-step timing on the search phase.

Which means `select_domain` should actually write the detail it accepts — it
currently ignores `p_detail`. Small fix:

```sql
  -- After the UPDATE, if a run already exists, record the check.
  if p_detail <> '{}'::jsonb then
    insert into private.provisioning_events (site_id, run_id, step, status, detail)
    select p_site_id, r.id, 'domain_check_account', 'succeeded', p_detail
      from private.provisioning_runs r
     where r.site_id = p_site_id
     order by r.queued_at desc
     limit 1;
  end if;
```

Silently does nothing when no run exists yet, which is the common case at
selection time.

---

## Rewire order

Each step is independently verifiable. Do not skip ahead.

**1. Apply `20260806000600_create_site.sql`.** Then confirm from psql with the
JWT preamble:

```sql
select public.create_site('Test Site', 'PEPE', 'So11111111111111111111111111111111111111112');
-- expect { site_id, s3_prefix: "PEPE_So11111/", originPath: "/PEPE_So11111", extended: false }
```

**2. Add `POST /api/sites` and `GET /api/sites`.** Split the `[siteId]` file out
of the same output.

**3. Thread `siteId` through `SiteBuilderWizard`.** This is the real work. State
gains a `siteId`, set by `create_site` on the new-site path and by the picker on
the existing-site path. Replace `site-existing-select.tsx`'s mock ids with
`GET /api/sites`.

**4. Rewire `site-domain-setup.tsx`.** Keep the search, verify and distribution
calls. Replace the setup call and the 3-second polling with
`startSetup()` + `useProvisioning()`.

**5. Render the timeline** with `buildTimeline()`. Delete the hardcoded 4-step
list — it is a divergent second implementation of the plan.

**6. Add the block dialog** using `blockGuidance()`. Mandatory note when
confirming a `domain_purchase`.

**7. Delete the legacy setup stack** once 4–6 are working.

---

## What is still genuinely missing after this

- **Workflow callbacks.** n8n does the AWS work and reports nothing, so runs sit
  `running` until reaped. Minimum viable is one node before
  `Respond to Webhook` reporting `ready` / `succeeded` — that alone flips
  `provisioning_status` and makes the site publishable.
- **Teardown route and workflow.** Schema is ready.
- **`SiteExecute`** — still a `setTimeout` stub, correctly so until the build
  pipeline is wired.

The audit's "no site ever gets created" was the right thing to surface first.
Everything else was downstream of it.