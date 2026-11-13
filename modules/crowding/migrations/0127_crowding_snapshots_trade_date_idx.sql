-- Reading the list of one session by its day.
CREATE INDEX CONCURRENTLY IF NOT EXISTS crowding_snapshots_trade_date_idx ON crowding_snapshots (trade_date);
