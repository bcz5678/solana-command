-- get_wallet_pnl_summary(): realized PnL per wallet, grouped.
-- Same read-side-bridge pattern as get_trades()/get_trade_stats() in
-- get_trades.sql — private.trade_logs isn't PostgREST-exposed, reads go
-- through SECURITY DEFINER RPCs. This is get_trade_stats()'s aggregate
-- logic (sol_spent / sol_received / net_sol, confirmed trades only) grouped
-- by wallet_id instead of collapsed into one row, for the Wallet PnL panel.
--
-- Run this in the Supabase SQL editor (Studio) to create/update. Not wired
-- into `supabase db push` — this repo has no migrations directory.
--
-- net_sol here is REALIZED PnL only (confirmed SELL amount_sol minus
-- confirmed BUY amount_sol) — it does not mark open token positions to
-- market. A wallet still holding tokens it bought but hasn't sold will show
-- net_sol as negative (or less positive) than its true position value until
-- it sells, same as get_trade_stats().

CREATE OR REPLACE FUNCTION public.get_wallet_pnl_summary(
  target_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  wallet_id     uuid,
  buy_count     bigint,
  sell_count    bigint,
  trade_count   bigint,
  sol_spent     numeric,
  sol_received  numeric,
  net_sol       numeric,
  last_trade_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = private, public
AS $$
BEGIN
  IF (SELECT public.is_super_admin()) THEN
    RETURN QUERY
      SELECT
        tl.wallet_id,
        COUNT(*) FILTER (WHERE tl.side = 'BUY'),
        COUNT(*) FILTER (WHERE tl.side = 'SELL'),
        COUNT(*),
        COALESCE(SUM(tl.amount_sol) FILTER (WHERE tl.side = 'BUY'  AND tl.status = 'confirmed'), 0),
        COALESCE(SUM(tl.amount_sol) FILTER (WHERE tl.side = 'SELL' AND tl.status = 'confirmed'), 0),
        COALESCE(SUM(tl.amount_sol) FILTER (WHERE tl.side = 'SELL' AND tl.status = 'confirmed'), 0)
          - COALESCE(SUM(tl.amount_sol) FILTER (WHERE tl.side = 'BUY' AND tl.status = 'confirmed'), 0),
        MAX(tl.executed_at)
      FROM private.trade_logs tl
      JOIN private.wallets w ON w.id = tl.wallet_id
      WHERE (target_user_id IS NULL OR w.user_id = target_user_id)
      GROUP BY tl.wallet_id;

  ELSIF auth.uid() IS NOT NULL THEN
    RETURN QUERY
      SELECT
        tl.wallet_id,
        COUNT(*) FILTER (WHERE tl.side = 'BUY'),
        COUNT(*) FILTER (WHERE tl.side = 'SELL'),
        COUNT(*),
        COALESCE(SUM(tl.amount_sol) FILTER (WHERE tl.side = 'BUY'  AND tl.status = 'confirmed'), 0),
        COALESCE(SUM(tl.amount_sol) FILTER (WHERE tl.side = 'SELL' AND tl.status = 'confirmed'), 0),
        COALESCE(SUM(tl.amount_sol) FILTER (WHERE tl.side = 'SELL' AND tl.status = 'confirmed'), 0)
          - COALESCE(SUM(tl.amount_sol) FILTER (WHERE tl.side = 'BUY' AND tl.status = 'confirmed'), 0),
        MAX(tl.executed_at)
      FROM private.trade_logs tl
      JOIN private.wallets w ON w.id = tl.wallet_id
      WHERE w.user_id = auth.uid()   -- hard-scoped, not overridable
      GROUP BY tl.wallet_id;

  ELSE
    RETURN;
  END IF;
END;
$$;

REVOKE ALL    ON FUNCTION public.get_wallet_pnl_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_wallet_pnl_summary(uuid) TO authenticated;
