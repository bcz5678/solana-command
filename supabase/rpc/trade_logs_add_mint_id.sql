-- trade_logs: add missing mint_id column
--
-- Root cause of "no trade logs anywhere." log_trade() (and get_trades.sql's
-- SELECT list, and the TradeLog type in lib/types/trades.ts) all reference
-- private.trade_logs.mint_id, but the live table was never actually given
-- that column. Every call to log_trade() has been failing with:
--   42703: column "mint_id" of relation "trade_logs" does not exist
-- silently — logTrade() (lib/trades/log.ts) swallows the error by design (a
-- failed log must never turn a successful on-chain trade into an error
-- response), so trades kept succeeding normally with zero visible error
-- while nothing ever reached trade_logs, from any route.
--
-- Confirmed directly: called log_trade() live through the Kong/PostgREST
-- gateway with the service-role key and got the above error back verbatim.
--
-- Run this in the Supabase SQL editor (Studio).

ALTER TABLE private.trade_logs
  ADD COLUMN IF NOT EXISTS mint_id uuid REFERENCES private.token_mints(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_trade_logs_mint
  ON private.trade_logs (mint_id)
  WHERE mint_id IS NOT NULL;
