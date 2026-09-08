-- get_wallet_trade_fills(): every confirmed BUY/SELL fill per wallet+mint,
-- oldest first — raw material for FIFO lot-based open-position accounting
-- (see app/api/wallet/pnl/route.ts's computeFifoOpenPositions()). Supersedes
-- get_wallet_open_positions()'s average-cost SQL aggregate: FIFO requires an
-- ORDERED walk consuming lots in sequence as they're sold, which is a
-- natural loop in TypeScript and an awkward one in set-based SQL — this
-- function's only job is handing back correctly-ordered raw fills; the
-- actual lot consumption happens in the API route.
--
-- Why FIFO matters here specifically: this platform's sniper-flush feature
-- (staggered-buy-wizard.tsx's Sell & Rebuy panel) sells part of an
-- already-bought position to shake out a sniper, then rebuys it. Under
-- average-cost, that whole sell+rebuy cycle just blends into one big pool,
-- hiding what's ACTUALLY still held. FIFO consumes the ORIGINAL (oldest) buy
-- lot on the flush-sell, and the rebuy becomes a distinct new lot at
-- whatever price it actually landed at — correctly reflecting that what's
-- sitting in the wallet afterward is (part of) the original lot plus the
-- rebuy lot, each at its own real cost, not one blended average.
--
-- Run this in the Supabase SQL editor (Studio) to create/update. Not wired
-- into `supabase db push` — this repo has no migrations directory. Depends
-- on pnl_baseline.sql already being applied (private.pnl_baseline).
--
-- Also respects each wallet owner's pnl_baseline.since (the panel's manual
-- "reset" control) — fills before it are excluded so a FIFO walk over the
-- remainder starts clean, same reasoning as get_wallet_pnl_summary.

DROP FUNCTION IF EXISTS public.get_wallet_open_positions(uuid);

CREATE OR REPLACE FUNCTION public.get_wallet_trade_fills(
  target_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  wallet_id     uuid,
  mint_address  text,
  token_symbol  text,
  token_name    text,
  decimals      smallint,
  side          text,
  quantity      numeric,
  amount_sol    numeric,
  executed_at   timestamptz
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
        tl.wallet_id, tl.to_address, tm.token_symbol, tm.token_name,
        COALESCE(tm.decimals, 6), tl.side, tl.quantity, tl.amount_sol, tl.executed_at
      FROM private.trade_logs tl
      JOIN private.wallets w ON w.id = tl.wallet_id
      LEFT JOIN private.token_mints tm ON tm.mint_public_key = tl.to_address
      LEFT JOIN private.pnl_baseline pb ON pb.user_id = w.user_id
      WHERE (target_user_id IS NULL OR w.user_id = target_user_id)
        AND tl.side IN ('BUY', 'SELL')
        AND tl.status = 'confirmed'
        AND tl.quantity   IS NOT NULL
        AND tl.amount_sol IS NOT NULL
        AND tl.executed_at >= COALESCE(pb.since, '-infinity'::timestamptz)
      ORDER BY tl.wallet_id, tl.to_address, tl.executed_at ASC;

  ELSIF auth.uid() IS NOT NULL THEN
    RETURN QUERY
      SELECT
        tl.wallet_id, tl.to_address, tm.token_symbol, tm.token_name,
        COALESCE(tm.decimals, 6), tl.side, tl.quantity, tl.amount_sol, tl.executed_at
      FROM private.trade_logs tl
      JOIN private.wallets w ON w.id = tl.wallet_id
      LEFT JOIN private.token_mints tm ON tm.mint_public_key = tl.to_address
      LEFT JOIN private.pnl_baseline pb ON pb.user_id = w.user_id
      WHERE w.user_id = auth.uid()   -- hard-scoped, not overridable
        AND tl.side IN ('BUY', 'SELL')
        AND tl.status = 'confirmed'
        AND tl.quantity   IS NOT NULL
        AND tl.amount_sol IS NOT NULL
        AND tl.executed_at >= COALESCE(pb.since, '-infinity'::timestamptz)
      ORDER BY tl.wallet_id, tl.to_address, tl.executed_at ASC;

  ELSE
    RETURN;
  END IF;
END;
$$;

REVOKE ALL    ON FUNCTION public.get_wallet_trade_fills(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_wallet_trade_fills(uuid) TO authenticated;
