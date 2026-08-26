-- public.record_domain_purchase_event — lets an authenticated site owner
-- record a domain_purchase event on their own purchase run, without an
-- orchestrator run_token.
--
-- Mirrors private.record_provisioning_event's event-insert shape and
-- run-status transitions. Two things intentionally differ, both because
-- this wrapper is scoped to exactly one step on exactly one run kind:
--
--   1. Auth is `owns_site`, not a run_token — there is no orchestrator
--      involved on this path. The route that calls this writes 'started'
--      immediately before it makes its own outbound call to the purchase
--      webhook, and writes the terminal status from the synchronous HTTP
--      response to that same call — there is no inbound n8n payload being
--      trusted here at all. record_provisioning_app_step exists so a
--      compromised n8n cannot forge WHY a domain was chosen; the only
--      forgeable claim here is "I purchased a domain I did not purchase,"
--      made by a site's own owner, about their own site — which costs
--      them nothing and gains them nothing.
--
--   2. record_provisioning_event's terminal-step detection (`v_final_step`)
--      resolves to 'ready' for any non-teardown run kind — correct for
--      `setup`, meaningless for `purchase`, whose only step IS
--      domain_purchase. Mirrored verbatim, a succeeded domain_purchase
--      event would never mark its run 'completed'. Here, `succeeded` on
--      domain_purchase (the run's only step) is unconditionally terminal.
--
--      Similarly, record_provisioning_event flips 'claimed' -> 'running' on
--      a 'started' event, because the orchestrator dispatch step always
--      claims a run before n8n reports anything. This path has no dispatch
--      step — start_domain_purchase leaves new runs at the table default
--      ('queued') — so 'started' here moves the run straight to 'running'.

create or replace function public.record_domain_purchase_event(
  p_run_id uuid,
  p_status text,
  p_detail jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'private', 'public', 'pg_temp'
as $function$
declare
  v_run    private.provisioning_runs;
  v_status private.provisioning_event_status;
begin
  select * into v_run from private.provisioning_runs where id = p_run_id for update;

  -- Guard 1 — caller owns the site the run belongs to. Combined with the
  -- not-found check, same as record_provisioning_app_step: a non-owner gets
  -- the identical "not found" whether the run is missing or someone else's.
  if v_run.id is null or not private.owns_site(v_run.site_id) then
    raise exception 'provisioning run not found';
  end if;

  -- Guard 2 — a setup or teardown run must not accept a domain_purchase
  -- event through this door.
  if v_run.run_kind <> 'purchase' then
    raise exception 'provisioning run % is a % run, not purchase', p_run_id, v_run.run_kind;
  end if;

  -- Guard 3 — no silent recording of a typo'd status.
  if p_status not in ('started', 'succeeded', 'failed', 'blocked') then
    raise exception 'status must be started, succeeded, failed or blocked, got "%"', p_status;
  end if;
  v_status := p_status::private.provisioning_event_status;

  -- Guard 4 — mirrors record_provisioning_event exactly: raises, does not
  -- return a soft conflict.
  if v_run.status in ('completed', 'failed', 'cancelled') then
    raise exception 'provisioning run % is already %', p_run_id, v_run.status;
  end if;

  -- Guard 5 — a second 'started' on a purchase run means a code path is
  -- about to buy twice.
  if v_status = 'started' and exists (
    select 1 from private.provisioning_events
     where run_id = p_run_id
       and step = 'domain_purchase'
       and status = 'started'
  ) then
    raise exception 'run % already has a started domain_purchase event', p_run_id;
  end if;

  insert into private.provisioning_events (site_id, run_id, step, status, detail)
  values (v_run.site_id, p_run_id, 'domain_purchase', v_status, p_detail);

  update private.provisioning_runs r
     set heartbeat_at = now(),
         status = (case
                     when v_status = 'failed'    then 'failed'
                     when v_status = 'blocked'   then 'blocked'
                     when v_status = 'succeeded' then 'completed'
                     -- 'started': no orchestrator claim step precedes this
                     -- path, so queued -> running directly rather than
                     -- gating on status = 'claimed'.
                     else 'running'
                   -- Cast required: unlike record_provisioning_event's version
                   -- of this CASE, every branch here is a bare string literal
                   -- (no r.status in the ELSE to anchor an enum type), so
                   -- Postgres resolves the expression to text and the
                   -- assignment fails with "column status is of type
                   -- provisioning_run_status but expression is of type text."
                   end)::private.provisioning_run_status,
         started_at     = coalesce(r.started_at, now()),
         blocked_step   = case when v_status = 'blocked' then 'domain_purchase'::private.provisioning_step else r.blocked_step end,
         blocked_reason = case when v_status = 'blocked' then p_detail ->> 'reason' else r.blocked_reason end,
         blocked_detail = case when v_status = 'blocked' then p_detail else r.blocked_detail end,
         error_detail   = case when v_status = 'failed'  then p_detail else r.error_detail end,
         finished_at    = case when v_status in ('failed', 'succeeded') then now() else r.finished_at end
   where r.id = p_run_id;

  return jsonb_build_object(
    'run_id', p_run_id,
    'step',   'domain_purchase'::text,
    'status', v_status::text
  );
end;
$function$;

revoke all on function public.record_domain_purchase_event(uuid, text, jsonb) from public, anon;
grant execute on function public.record_domain_purchase_event(uuid, text, jsonb) to authenticated;
