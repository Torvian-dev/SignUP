-- Proxy quarantine: when a site blocks or rate-limits a profile, its proxy is put on a cooldown
-- so the batch stops burning accounts through a flagged IP and skips that profile until it clears.
ALTER TABLE profile_proxies
  ADD COLUMN IF NOT EXISTS cooldown_until   timestamptz,
  ADD COLUMN IF NOT EXISTS block_count      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_block_reason text;
