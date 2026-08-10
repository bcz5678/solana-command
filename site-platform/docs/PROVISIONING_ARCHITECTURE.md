# Domain provisioning — architecture

Read alongside `CLAUDE.md`. Everything there applies; this covers the
provisioning subsystem specifically.

---

## What this does

Takes a site from "no domain" to "publishable" — buying or selecting a domain,
creating its S3 folder, issuing a certificate, wiring DNS, and attaching it to a
CloudFront distribution. Then, later, releases the domain so it can be reused.

Sites are **event-driven and short-lived** — weeks, not years. Domains have a
one-year minimum, so the account accumulates idle inventory and *reuse becomes
the common path*, not the exception. That shapes several decisions below.

---

## Actors

| Actor | Owns | Holds |
|---|---|---|
| Wizard (browser) | Domain choice, distribution choice | User session |
| Next.js | Orchestration, all credentials | service_role, AWS, shared secret |
| Postgres | Truth: runs, events, plan resolution | — |
| n8n | Namecheap and AWS API calls | Shared secret, AWS, Namecheap |

**n8n holds no database credential.** It receives a `run_token` in the dispatch
payload and posts step results to `/api/internal/provisioning/:runId/step`. This
is deliberate and load-bearing — if a task seems to need n8n reading Postgres,
the payload is missing a field.

---

## Three run kinds

One machinery, three workflows.

| Kind | Workflow | Steps |
|---|---|---|
| `purchase` | Token - Domain Purchase | `domain_purchase` |
| `setup` | Token - Domain Setup | `s3_folder` → `cert_request` → `cert_validation_records` → `dns_host_records` → `cert_validation_wait` → `distribution_configure` → `distribution_deploy` → `ready` |
| `teardown` | Token - Domain Teardown | `remove_alias` → `delete_cert` → `domain_released` → (`purge_media` → `purge_prefix` → `archive_site`) |

`domain_search` and `domain_check_account` are **app-side** — recorded through
`record_provisioning_app_step` with the user's own session, so a compromised n8n
cannot forge the record of why a domain was chosen.

`dns_cname` exists in the enum but is **retired** — excluded from `step_kind()`,
so it never appears in a plan. `dns_host_records` writes the distribution CNAME
in the same Namecheap `setHosts` call.

---

## The plan

The single most important concept. `provisioning_plan(run_id)` returns every
step for that run's kind with an action:

| Action | Meaning |
|---|---|
| `run` | Do it |
| `skip` | Already done, or not applicable |
| `block` | Needs a human before anything continues |

Resolved server-side and handed to n8n **as data**. That is what lets a re-run
resume rather than restart, without n8n querying anything.

Derived from events for the **site**, not the run — which is why a second
attempt skips what the first accomplished. Teardown is the exception: it scopes
to the run, because a site can legitimately be torn down more than once across
repurposing cycles.

### How n8n consumes it

Not nine guards — one Switch. The setup steps are strictly sequential, so a
resume is always "enter at step N and run to the end":

```
verify HMAC → Code: find first action==='run' → report skips → Switch(entryStep)
```

Special cases the entry node must handle:

- `block` anywhere → throw (dispatch preflights this; reaching here is a bug)
- nothing runnable → throw (same)
- `ready` is the only runnable step → route to `ready_only`, straight to the
  final report. Routing it through the chain would re-fire `skipped` events for
  steps that already have `succeeded` ones.
- Switch fallback output → report `failed` with "no branch for this step", which
  is what happens when the enum gains a step the workflow does not know

---

## `domain_purchase` never auto-retries

The one irreversible step that spends money.

n8n reports `started` **before** the Namecheap call. If the run dies between the
call and its result, the plan sees `started` with no terminal event and returns
`block` — because no automated check can distinguish "Namecheap accepted the
order but our process died" from "the order never landed" reliably enough to
risk buying twice.

`resolve_provisioning_block(run_id, 'confirm'|'retry'|'abandon')` is the only
way past, and the resolve route **requires a note** when confirming a purchase —
the operator records the order reference they verified.

Skip the `started` report and an interrupted purchase looks like "not yet
attempted." The next run buys the domain again.

---

## Domain lifecycle

```
                    select_domain          start_domain_setup
  (no domain) ──────────────────────► claimed ──────────────► provisioned
       ▲            or purchase run                                │
       │                                                           │
       └────────────────── teardown (depth: release) ──────────────┘
                            domain_released
```

`sites.domain` is **not** UNIQUE. A partial index scopes the claim:

```sql
create unique index sites_domain_active_unique
  on private.sites (domain)
  where domain is not null
    and domain_released_at is null
    and not is_archived;
```

So a released or archived site keeps its history without blocking reuse. That is
the repurposing path, and it is why teardown exists as a run kind rather than a
`DELETE`.

`domain_source` (`purchase` | `in_account` | `external`) lives on **`sites`**,
not on the run. It is site state. Both start functions read it; passing it as a
parameter is only a fallback for a site whose domain predates the column.

`external` is in the enum but effectively unsupported — the setup workflow
writes DNS through Namecheap's `setHosts`, which only works for domains
delegated to Namecheap nameservers. Do not offer it in the wizard without
solving that first.

---

## Teardown depth

```
remove_alias      ─┐
delete_cert       ─┘  domain is reusable after this
domain_released    ←  'release' stops here
purge_media       ─┐
purge_prefix       │  'full' only
archive_site      ─┘
```

Ordering is deliberate. Someone reclaiming a domain before a launch runs
`release` and is done in seconds; `full` is housekeeping that can fail or be
deferred.

`remove_alias` is the step that actually frees the domain: **CloudFront rejects
a duplicate CNAME across the entire account**, so a leftover alias blocks the
next site from claiming it — even on the same distribution.

The plan marks `remove_alias` as `skip` when a new setup run is already
targeting the same distribution. Remove-then-add would be two
`UpdateDistribution` calls with a window in between where the domain resolves
nowhere; the new run's `distribution_configure` overwrites the alias in one.

`archive_site` does **not** delete `site_versions` — they are small jsonb, and
"what did we ship on that domain last time" is exactly what you want when
repurposing.

---

## Two string formats for one folder

| Field | Format | Used by |
|---|---|---|
| `sites.s3_prefix` | `PEPE_7xKXtg2/` | S3 keys |
| `origin_path` | `/PEPE_7xKXtg2` | CloudFront OriginPath |

`start_domain_setup` derives the second from the first so they cannot drift.
Sending the wrong one to the wrong API is the easy mistake.

`s3_prefix` is **wizard output** — the folder is created before setup runs, and
the `{SYMBOL}_{CA[0:7]}/` naming scheme is the wizard's. A validation trigger
enforces the shape. Nothing in the API should invent one; `start_domain_setup`
raises if it is absent.

---

## Timing

| Step | Typical | Notes |
|---|---|---|
| `s3_folder` | seconds | |
| `cert_request` | seconds | |
| `cert_validation_records` | seconds | ACM populates `ResourceRecord` shortly after the request |
| `dns_host_records` | seconds | |
| `cert_validation_wait` | **1–30 min** | External DNS propagation. Set a low TTL in `dns_host_records` |
| `distribution_configure` | seconds | |
| `distribution_deploy` | **1–10 min** | HTTP probe against the live URL |

The two slow steps report `started` on **every** poll iteration. That is the
only thing refreshing `heartbeat_at` — without it, a slow cert is
indistinguishable from a dead workflow and `reap_stale_provisioning` fails a
healthy run at 60 minutes.

The UI must show elapsed time and an explanation for these, not a spinner. A
silent 15-minute wait is what makes someone reload or re-run.

---

## Failure and recovery

**Transition safety** — a terminal run rejects further reports (409). A stale
`run_token` is rejected; `resolve_provisioning_block` rotates it so a zombie
execution from the failed attempt cannot report into the resumed run.

**Concurrency** — one active run per `(site_id, run_kind)`, so a stalled
purchase does not block setup on a domain that turned out to be already owned.

**Reaper** — `reap_stale_provisioning` runs in pg_cron every 10 minutes with a
**60-minute** threshold, not the build pipeline's 15. Blocked runs are never
reaped; they are waiting on a human by design.

**Durability** — the queue. A lost fire-and-forget dispatch leaves the run
`queued`; the sweep claims it. That is why dispatch is not inline.

---

## Testing

`scripts/reset-site.ts` wipes DB state. **It is not an AWS reset** — the ACM
cert and CloudFront alias from the previous attempt survive, and the alias will
block the re-run with an error that reads like a permissions problem. The script
prints the exact cleanup commands with ARNs substituted. Run them.

`rewind_provisioning(site_id, 'cert_request')` replays from one step onward,
which is usually what you want over a full reset.

Testing helpers refuse to run when `app.environment` is `production`.

---

## Gaps a task may hit

Known-incomplete, in rough priority order:

1. **Workflow callbacks are not wired.** The setup workflow does the AWS work
   but reports nothing, so runs sit `running` until reaped. Minimum viable is
   one node before `Respond to Webhook` reporting `ready` / `succeeded` — that
   alone flips `provisioning_status` and makes the site publishable.
2. **Teardown workflow does not exist.** Schema and routes are ready.
3. **`distribution_deploy` has no node.** A placeholder reporting `skipped` is
   the interim; the real version is an HTTP probe loop against the live URL.
4. **Namecheap credentials are hardcoded** as node parameters in the setup
   workflow — unencrypted in exports and execution logs. Move to a credential
   and rotate the key.
5. **`Wait` nodes default to hours.** Empty parameters mean a 1-hour delay in
   the cert polling loop. Set `unit: "seconds"` explicitly.
6. **No webhook auth** on the setup workflow beyond the path. Verify the
   `X-Signature` HMAC in node 2.
7. **No error workflow.** A mid-cert failure leaves the run silent.
8. **`purge_media` needs an app endpoint** — n8n has no Supabase credential, so
   it calls back the same way media derivation does.

---

## Where things live

```
supabase/migrations/
  ..._provisioning.sql              runs, events, plan, claim, reaper
  ..._provisioning_api.sql          public wrappers
  ..._teardown_enums.sql            enum additions (must commit first)
  ..._teardown.sql                  teardown kind, release columns
  ..._setup_accepts_domain.sql      select_domain, domain_source on sites
  ..._testing_helpers.sql           reset/rewind/unblock

app/api/
  internal/provisioning/
    dispatch/route.ts               claim + hand off, per-kind webhook
    [runId]/step/route.ts           n8n callbacks
    sweep/route.ts                  cron target
  sites/[siteId]/
    provisioning/route.ts           start + timeline
    provisioning/resolve/route.ts   block resolution
    domain/route.ts                 select a domain, list claims

lib/provisioning/client.ts          typed fetchers, Realtime hook, timeline
scripts/reset-site.ts               testing reset
```

Reference docs: `CALLBACK_REFERENCE.md` (every accepted message per step),
`TEARDOWN_WORKFLOW.md` (teardown spec).

---

## Invariants

Breaking these produces silent inconsistency rather than an error.

1. **n8n never touches Postgres.** Everything arrives in the payload; results go
   through `/api/internal/*`.
2. **The plan is authoritative.** n8n does not decide what to skip.
3. **`domain_purchase` blocks rather than retries** when interrupted.
4. **`provisioning_status = 'ready'` is set only by `ready`/`succeeded` on a
   setup run.** Nothing else unblocks publishing.
5. **`s3_prefix` is wizard output.** Never constructed by the API, never
   defaulted. A constructed prefix points somewhere CloudFront is not serving,
   producing a green build and a 404 domain.
6. **Events are append-only.** Corrections are new events, not edits.
7. **`sites.domain_source` is site state**, read by both start functions.