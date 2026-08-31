-- log_trade()
-- Write-side counterpart to get_trades()/get_trade_stats() (see get_trades.sql).
-- Called by lib/trades/log.ts's logTrade() via the admin (service_role) client
-- from every buy/sell/bundle/staggered route. Returns {"log_id": uuid} so the
-- caller can correlate its own logging without a second round trip.
--
-- service_role only — same gating as get_token_mint_id_by_pubkey(), since
-- trade_logs has no RLS (private schema, not PostgREST-exposed) and every
-- caller already holds the admin client for vault access.
--
-- Run this in the Supabase SQL editor (Studio) to create/update the function.
-- Not wired into `supabase db push` — this repo has no migrations directory,
-- schema changes are applied by hand via Studio (same as get_trades.sql).

CREATE OR REPLACE FUNCTION public.log_trade(
  p_wallet_id      uuid,
  p_side           text,
  p_exchange       text,
  p_symbol         text,
  p_to_address     text,
  p_amount_sol     numeric DEFAULT NULL,
  p_quantity       numeric DEFAULT NULL,
  p_price          numeric DEFAULT NULL,
  p_tx_signature   text    DEFAULT NULL,
  p_status         text    DEFAULT 'confirmed',
  p_mint_id        uuid    DEFAULT NULL,
  p_order_type     text    DEFAULT 'MARKET',
  p_slippage_bps   integer DEFAULT NULL,
  p_price_impact   numeric DEFAULT NULL,
  p_error_message  text    DEFAULT NULL,
  p_raw_response   jsonb   DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: requires service_role';
  END IF;

  INSERT INTO private.trade_logs (
    wallet_id, side, exchange, symbol, to_address,
    amount_sol, quantity, price, tx_signature, status,
    mint_id, order_type, slippage_bps, price_impact, error_message, raw_response
  ) VALUES (
    p_wallet_id, p_side, p_exchange, p_symbol, p_to_address,
    p_amount_sol, p_quantity, p_price, p_tx_signature, p_status,
    p_mint_id, p_order_type, p_slippage_bps, p_price_impact, p_error_message, p_raw_response
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('log_id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.log_trade(uuid,text,text,text,text,numeric,numeric,numeric,text,text,uuid,text,integer,numeric,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_trade(uuid,text,text,text,text,numeric,numeric,numeric,text,text,uuid,text,integer,numeric,text,jsonb) FROM authenticated;
REVOKE ALL ON FUNCTION public.log_trade(uuid,text,text,text,text,numeric,numeric,numeric,text,text,uuid,text,integer,numeric,text,jsonb) FROM anon;
