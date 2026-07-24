-- get_trades() / get_trade_stats()
-- Read-side bridge for private.trade_logs (written by lib/trades/log.ts's
-- logTrade() -> log_trade() RPC). trade_logs lives in the private schema and
-- is not PostgREST-exposed, so reads go through these SECURITY DEFINER
-- functions — same pattern as get_wallets() / get_token_mints().
--
-- Run this in the Supabase SQL editor (Studio) to create/update both
-- functions. Not wired into `supabase db push` — this repo has no migrations
-- directory, schema changes are applied by hand via Studio.
--
-- Scoping:
--   super admin           -> all trades, optionally filtered by target_user_id
--   authenticated, non-admin -> only trades for wallets they own
--   unauthenticated        -> nothing
--
-- Ownership is derived by joining through private.wallets (trade_logs has no
-- user_id column of its own) — a trade belongs to whoever owns the wallet
-- that made it.

-- ── get_trades() ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_trades(
  target_user_id uuid        DEFAULT NULL,
  p_wallet_id    uuid        DEFAULT NULL,
  p_mint_id      uuid        DEFAULT NULL,
  p_side         text        DEFAULT NULL,   -- 'BUY' | 'SELL'
  p_status       text        DEFAULT NULL,   -- 'pending' | 'confirmed' | 'failed' | 'cancelled'
  p_exchange     text        DEFAULT NULL,   -- 'pump.fun' | 'jupiter' | ...
  p_from         timestamptz DEFAULT NULL,
  p_to           timestamptz DEFAULT NULL,
  p_limit        integer     DEFAULT 100,
  p_offset       integer     DEFAULT 0
)
RETURNS TABLE (
  id            uuid,
  wallet_id     uuid,
  wallet_label  text,
  wallet_pubkey text,
  mint_id       uuid,
  token_name    text,
  token_symbol  text,
  exchange      text,
  symbol        text,
  side          text,
  order_type    text,
  quantity      numeric,
  price         numeric,
  amount_sol    numeric,
  to_address    text,
  tx_signature  text,
  status        text,
  slippage_bps  integer,
  price_impact  numeric,
  error_message text,
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
        tl.id, tl.wallet_id, w.label, w.public_key,
        tl.mint_id, tm.token_name, tm.token_symbol,
        tl.exchange, tl.symbol, tl.side, tl.order_type,
        tl.quantity, tl.price, tl.amount_sol, tl.to_address,
        tl.tx_signature, tl.status, tl.slippage_bps, tl.price_impact,
        tl.error_message, tl.executed_at
      FROM private.trade_logs tl
      JOIN private.wallets w ON w.id = tl.wallet_id
      LEFT JOIN private.token_mints tm ON tm.id = tl.mint_id
      WHERE (target_user_id IS NULL OR w.user_id = target_user_id)
        AND (p_wallet_id IS NULL OR tl.wallet_id = p_wallet_id)
        AND (p_mint_id   IS NULL OR tl.mint_id   = p_mint_id)
        AND (p_side      IS NULL OR tl.side      = p_side)
        AND (p_status    IS NULL OR tl.status    = p_status)
        AND (p_exchange  IS NULL OR tl.exchange  = p_exchange)
        AND (p_from      IS NULL OR tl.executed_at >= p_from)
        AND (p_to        IS NULL OR tl.executed_at <= p_to)
      ORDER BY tl.executed_at DESC
      LIMIT p_limit OFFSET p_offset;

  ELSIF auth.uid() IS NOT NULL THEN
    RETURN QUERY
      SELECT
        tl.id, tl.wallet_id, w.label, w.public_key,
        tl.mint_id, tm.token_name, tm.token_symbol,
        tl.exchange, tl.symbol, tl.side, tl.order_type,
        tl.quantity, tl.price, tl.amount_sol, tl.to_address,
        tl.tx_signature, tl.status, tl.slippage_bps, tl.price_impact,
        tl.error_message, tl.executed_at
      FROM private.trade_logs tl
      JOIN private.wallets w ON w.id = tl.wallet_id
      LEFT JOIN private.token_mints tm ON tm.id = tl.mint_id
      WHERE w.user_id = auth.uid()   -- hard-scoped, not overridable
        AND (p_wallet_id IS NULL OR tl.wallet_id = p_wallet_id)
        AND (p_mint_id   IS NULL OR tl.mint_id   = p_mint_id)
        AND (p_side      IS NULL OR tl.side      = p_side)
        AND (p_status    IS NULL OR tl.status    = p_status)
        AND (p_exchange  IS NULL OR tl.exchange  = p_exchange)
        AND (p_from      IS NULL OR tl.executed_at >= p_from)
        AND (p_to        IS NULL OR tl.executed_at <= p_to)
      ORDER BY tl.executed_at DESC
      LIMIT p_limit OFFSET p_offset;

  ELSE
    RETURN;
  END IF;
END;
$$;

REVOKE ALL    ON FUNCTION public.get_trades(uuid,uuid,uuid,text,text,text,timestamptz,timestamptz,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_trades(uuid,uuid,uuid,text,text,text,timestamptz,timestamptz,integer,integer) TO authenticated;


-- ── get_trade_stats() ─────────────────────────────────────────
-- Same filters as get_trades() minus limit/offset — one aggregate row.
-- sol_spent / sol_received / net_sol only count 'confirmed' trades, since
-- failed attempts never moved any SOL.
CREATE OR REPLACE FUNCTION public.get_trade_stats(
  target_user_id uuid        DEFAULT NULL,
  p_wallet_id    uuid        DEFAULT NULL,
  p_mint_id      uuid        DEFAULT NULL,
  p_side         text        DEFAULT NULL,
  p_status       text        DEFAULT NULL,
  p_exchange     text        DEFAULT NULL,
  p_from         timestamptz DEFAULT NULL,
  p_to           timestamptz DEFAULT NULL
)
RETURNS TABLE (
  total_trades     bigint,
  confirmed_trades bigint,
  failed_trades    bigint,
  buy_count        bigint,
  sell_count       bigint,
  sol_spent        numeric,
  sol_received     numeric,
  net_sol          numeric,
  first_trade_at   timestamptz,
  last_trade_at    timestamptz
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
        COUNT(*),
        COUNT(*) FILTER (WHERE tl.status = 'confirmed'),
        COUNT(*) FILTER (WHERE tl.status = 'failed'),
        COUNT(*) FILTER (WHERE tl.side = 'BUY'),
        COUNT(*) FILTER (WHERE tl.side = 'SELL'),
        COALESCE(SUM(tl.amount_sol) FILTER (WHERE tl.side = 'BUY'  AND tl.status = 'confirmed'), 0),
        COALESCE(SUM(tl.amount_sol) FILTER (WHERE tl.side = 'SELL' AND tl.status = 'confirmed'), 0),
        COALESCE(SUM(tl.amount_sol) FILTER (WHERE tl.side = 'SELL' AND tl.status = 'confirmed'), 0)
          - COALESCE(SUM(tl.amount_sol) FILTER (WHERE tl.side = 'BUY' AND tl.status = 'confirmed'), 0),
        MIN(tl.executed_at),
        MAX(tl.executed_at)
      FROM private.trade_logs tl
      JOIN private.wallets w ON w.id = tl.wallet_id
      WHERE (target_user_id IS NULL OR w.user_id = target_user_id)
        AND (p_wallet_id IS NULL OR tl.wallet_id = p_wallet_id)
        AND (p_mint_id   IS NULL OR tl.mint_id   = p_mint_id)
        AND (p_side      IS NULL OR tl.side      = p_side)
        AND (p_status    IS NULL OR tl.status    = p_status)
        AND (p_exchange  IS NULL OR tl.exchange  = p_exchange)
        AND (p_from      IS NULL OR tl.executed_at >= p_from)
        AND (p_to        IS NULL OR tl.executed_at <= p_to);

  ELSIF auth.uid() IS NOT NULL THEN
    RETURN QUERY
      SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE tl.status = 'confirmed'),
        COUNT(*) FILTER (WHERE tl.status = 'failed'),
        COUNT(*) FILTER (WHERE tl.side = 'BUY'),
        COUNT(*) FILTER (WHERE tl.side = 'SELL'),
        COALESCE(SUM(tl.amount_sol) FILTER (WHERE tl.side = 'BUY'  AND tl.status = 'confirmed'), 0),
        COALESCE(SUM(tl.amount_sol) FILTER (WHERE tl.side = 'SELL' AND tl.status = 'confirmed'), 0),
        COALESCE(SUM(tl.amount_sol) FILTER (WHERE tl.side = 'SELL' AND tl.status = 'confirmed'), 0)
          - COALESCE(SUM(tl.amount_sol) FILTER (WHERE tl.side = 'BUY' AND tl.status = 'confirmed'), 0),
        MIN(tl.executed_at),
        MAX(tl.executed_at)
      FROM private.trade_logs tl
      JOIN private.wallets w ON w.id = tl.wallet_id
      WHERE w.user_id = auth.uid()
        AND (p_wallet_id IS NULL OR tl.wallet_id = p_wallet_id)
        AND (p_mint_id   IS NULL OR tl.mint_id   = p_mint_id)
        AND (p_side      IS NULL OR tl.side      = p_side)
        AND (p_status    IS NULL OR tl.status    = p_status)
        AND (p_exchange  IS NULL OR tl.exchange  = p_exchange)
        AND (p_from      IS NULL OR tl.executed_at >= p_from)
        AND (p_to        IS NULL OR tl.executed_at <= p_to);

  ELSE
    RETURN;
  END IF;
END;
$$;

REVOKE ALL    ON FUNCTION public.get_trade_stats(uuid,uuid,uuid,text,text,text,timestamptz,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_trade_stats(uuid,uuid,uuid,text,text,text,timestamptz,timestamptz) TO authenticated;
