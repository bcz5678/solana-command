# Wizard integration guide

How the existing wizard UI connects to the provisioning subsystem.

Read `PROVISIONING_ARCHITECTURE.md` first — the invariants there constrain
everything below.

---

## API surface

### Domain selection

```
GET  /api/sites/:siteId/domain
     → { claims: [{ domain, site_id, site_name, claimed, released_at, last_used_at }] }

POST /api/sites/:siteId/domain
     { domain, domainSource?: "in_account" | "external" | "purchase", detail? }
     → { site_id, domain, domainSource, reclaimed }
     409 if another ACTIVE site holds it
     422 if this site is already provisioned
```

`GET` returns the **database half** of the picker. Cross-reference it against
the live Namecheap account list:

| In Namecheap | In claims | Show as |
|---|---|---|
| yes | no row | **Available** — never used here |
| yes | `claimed: true` | **In use** by *site name* |
| yes | `claimed: false` | **Available** — last used by *site name*, *date* |
| no | any row | **Expired** — no longer in the account, do not offer |

Surface **expiry** alongside availability. A domain expiring in three weeks is a
bad choice for a six-week event, and that is invisible from the name.

### Start a run

```
POST /api/sites/:siteId/provisioning
     { kind: "purchase", domain }
     { kind: "setup", distributionId, distributionUrl, domain?, domainSource? }
     → 202 { run_id, status, domain?, domainSource?, originPath? }
     409 domain in use by another site
     422 wrong site state (no domain, no s3_prefix, already provisioned)
```

`domain` on the setup path is optional — supply it to select and start in one
request, omit it when a purchase run or `POST /domain` already recorded it.

### Timeline

```
GET  /api/sites/:siteId/provisioning
     → { runs: [{ id, kind, status, domain, plan, events, blockedStep, ... }] }
```

Both kinds, newest first. `plan` and `events` are what `buildTimeline()` merges.

### Resolve a block

```
POST /api/sites/:siteId/provisioning/resolve
     { runId, resolution: "confirm" | "retry" | "abandon", note?, detail? }
     400 if confirming a domain_purchase without a note
     409 if the run is not blocked
```

---

## Client library

`lib/provisioning/client.ts`:

```ts
const { current, runs, isBlocked, isRunning, isComplete, isFailed, refresh }
  = useProvisioning(siteId);

const timeline = buildTimeline(current);   // merges plan + events
const guidance = blockGuidance(current);   // wording for the block dialog
const elapsed  = elapsedMs(entry);         // for slow steps
```

`useProvisioning` subscribes to Realtime on `provisioning_events` and
`provisioning_runs`, then **refetches** rather than patching from the payload —
the payload is one row, but the UI needs the resolved plan, which is computed
server-side. Reconstructing it client-side would be a second implementation of
`provisioning_plan`'s rules.

---

## Ordering the wizard must enforce

```
1. Site exists
2. s3_prefix set          ← wizard creates the S3 folder; API will not invent one
3. Domain chosen          ← purchase run, or POST /domain
4. Distribution chosen    ← live from AWS
5. Setup run
6. provisioning_status = 'ready'
7. Site is publishable
```

Steps 2 and 3 are the ones that produce 422s if skipped. The error messages name
which is missing.

---

## Rendering the timeline

`buildTimeline()` returns one entry per planned step:

```ts
{
  step, label, action, reason,
  state: "pending" | "running" | "succeeded" | "failed" | "skipped" | "blocked",
  events, startedAt, finishedAt, durationMs,
  isSlow,      // running AND a known-slow step
  attempts,    // poll count, from repeated 'started' events
}
```

Render **all** entries including skipped ones, with the `reason` visible.
"Purchase domain — skipped, domain already owned" is information; omitting the
row makes the wizard look like it has fewer stages than it does.

### Slow steps

`isSlow` is true for `cert_validation_wait` and `distribution_deploy` while
running. These legitimately take 1–30 minutes.

Show elapsed time and what is being waited on:

> **Validating certificate** — 4m 12s, attempt 9
> Waiting for DNS to propagate so Amazon can verify the domain.

Not a bare spinner. A silent 15-minute wait is what makes someone reload or
re-run, and a re-run mid-cert is how you end up with orphaned certificates.

---

## The block dialog

The one place provisioning genuinely needs a human, and almost always
`domain_purchase`.

`blockGuidance(run)` returns the wording. For a purchase:

> **Verify the domain purchase**
> A previous attempt to purchase pepecoin.io did not report a result, so we
> cannot tell whether it went through. Check the Namecheap account before
> continuing — retrying could buy the domain a second time.
>
> [ It was purchased — continue ]  [ It was not purchased — try again ]

`requiresNote: true` for purchases. Make the note field mandatory in the UI and
label it clearly: *"Namecheap order reference you verified"*. The API rejects a
confirm without one, but a 400 after the click is worse than a required field.

Abandon should be a secondary action with its own confirmation — it cancels the
run entirely.

---

## Distribution picker

Fetched live from AWS, not mirrored in the database. One distribution per
domain, so the team is choosing which to use or reuse.

Show for each: ID, domain name, current aliases, and whether any alias belongs
to a site in `domain_claims()`. A distribution whose alias is still held by an
active site is a bad choice — the setup run would replace it.

Pass both `distributionId` and `distributionUrl`; both are recorded on the run
and the site.

---

## Teardown UI

```
POST /api/sites/:siteId/teardown   { depth: "release" | "full" }
```

Route not yet written; `start_teardown` RPC exists.

Present as two distinct actions, not a dropdown:

- **Release domain** — makes the domain available for reuse. Fast. The common one.
- **Retire site** — release plus purge media, S3 content, and archive.

Both confirm. Release should name what becomes reusable; retire should be
explicit that content is deleted.

---

## Error handling

| Status | Meaning | UI |
|---|---|---|
| `409` | Domain held by another active site | Name the site, offer to open it |
| `422` | Wrong site state | Show which precondition failed |
| `202` | Run queued | Switch to the timeline |
| `200` + `message` | Run already in progress | Show the existing run |

That last one is easy to miss: `start_domain_setup` returns `200` with a
`message` when a setup run is already in flight, rather than erroring. Do not
treat a non-202 as failure.

---

## What not to do

**Do not poll `GET /provisioning`.** Realtime is wired; `useProvisioning`
handles it.

**Do not compute the plan client-side.** It is server-resolved for a reason.

**Do not construct `s3_prefix`.** Wizard output from the folder-creation step.

**Do not pass `domainSource` on every request.** It is site state once recorded.
Only supply it alongside a `domain` when selecting for the first time.

**Do not offer `external` as a domain source.** The setup workflow writes DNS
through Namecheap `setHosts`, which only works for domains delegated to
Namecheap nameservers.

**Do not hide skipped steps.** The reason is the information.

---

## Verifying end to end

Current state: n8n does the AWS work but reports nothing back, so runs sit
`running` until reaped at 60 minutes.

Until the callbacks are wired, expect:

- `POST /provisioning` → `202`, run appears as `queued`
- Dispatch hands off, run goes `claimed`
- n8n does the real work
- **Nothing further** — no events, no `ready`

That still proves dispatch, the payload shape, and the webhook path. Add one
callback node reporting `ready` / `succeeded` before `Respond to Webhook` and
the loop closes: `provisioning_status` flips to `ready` and the site becomes
publishable.