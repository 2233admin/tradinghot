-- What the last refresh found: the publisher's dates, the index summary that came with the list, and when
-- we last heard from it.
CREATE TABLE IF NOT EXISTS crowding_state (
  id text PRIMARY KEY,
  status text NOT NULL,
  message text,
  signal_date date,
  trade_date date,
  source_view text,
  index_date date,
  index_point numeric,
  index_annualized numeric,
  index_return_1d numeric,
  index_return_5d numeric,
  index_return_20d numeric,
  source_url text,
  source_sha256 text,
  published_at timestamptz,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
