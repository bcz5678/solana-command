-- trade_logs: add remaining missing columns
--
-- Follow-up to trade_logs_add_mint_id.sql. Postgres validates an INSERT's
-- column list one column at a time and stops at the first miss, so fixing
-- mint_id only revealed the NEXT missing column (slippage_bps) rather than
-- all of them at once. log_trade()'s full INSERT column list is:
--   wallet_id, side, exchange, symbol, to_address, amount_sol, quantity,
--   price, tx_signature, status, mint_id, order_type, slippage_bps,
--   price_impact, error_message, raw_response
-- Confirmed live: wallet_id..status and order_type already exist (no error
-- hit them); mint_id was just added. This adds everything from slippage_bps
-- onward in one shot instead of three more rounds of "run this, hit the
-- next one." Types match get_trades.sql's declared RETURNS TABLE shape.
--
-- Run this in the Supabase SQL editor (Studio).

ALTER TABLE private.trade_logs
  ADD COLUMN IF NOT EXISTS slippage_bps  integer,
  ADD COLUMN IF NOT EXISTS price_impact  numeric,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS raw_response  jsonb;
