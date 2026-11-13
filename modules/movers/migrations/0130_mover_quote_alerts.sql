-- The unusual moves the quote poller found: a name that just entered the market's movers list, or one
-- whose change jumped since the last poll.
CREATE TABLE IF NOT EXISTS mover_quote_alerts (
  id bigserial PRIMARY KEY,
  symbol text NOT NULL,
  name text NOT NULL,
  direction text NOT NULL,
  change_percent double precision NOT NULL,
  reason text NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now()
);
