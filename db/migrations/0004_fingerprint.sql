-- Per-profile browser fingerprint: a stable, distinct device identity per profile.
-- The rich fingerprint lives in `fingerprint` (jsonb); the legacy scalar columns stay
-- populated from it for readability and backward compatibility. `fp_version` lets the
-- app regenerate a profile's fingerprint when the generator algorithm changes.
ALTER TABLE browser_profiles
  ADD COLUMN IF NOT EXISTS fingerprint jsonb,
  ADD COLUMN IF NOT EXISTS fp_version  integer NOT NULL DEFAULT 0;
