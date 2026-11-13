-- The channels belong to the site (site/site.ts CHANNELS): a source may name one in its own config, so the
-- column no longer fixes the two values the framework shipped with.
ALTER TABLE publications DROP CONSTRAINT IF EXISTS publications_channel_check;
