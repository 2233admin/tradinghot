CREATE INDEX CONCURRENTLY IF NOT EXISTS fast_source_pending_idx ON fast_source_items (source_id, considered_at NULLS FIRST, discovered_at, identity_key) WHERE pending;
