-- The crowding list the public index publishes each day: one row per stock in its Top50, keyed by the
-- close it was computed from.
CREATE TABLE IF NOT EXISTS crowding_snapshots (
  signal_date date NOT NULL,
  trade_date date NOT NULL,
  ts_code text NOT NULL,
  name text NOT NULL,
  crowding_rank int NOT NULL,
  score numeric NOT NULL,
  today_return numeric NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (signal_date, ts_code)
);
