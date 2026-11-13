-- The last quote we read for each symbol: what the market's movers list said the last time we looked.
-- One row per symbol, replaced on every poll; the alerts table keeps what the comparison found.
CREATE TABLE IF NOT EXISTS mover_quote_snapshots (
  symbol text PRIMARY KEY,
  name text NOT NULL,
  change_percent double precision NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now()
);
