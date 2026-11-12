CREATE TABLE IF NOT EXISTS fast_source_items (
  source_id text NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  identity_key text NOT NULL,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL,
  first_import boolean NOT NULL DEFAULT false,
  pending boolean NOT NULL DEFAULT true,
  considered_at timestamptz,
  rules_key text,
  PRIMARY KEY (source_id, identity_key)
);
