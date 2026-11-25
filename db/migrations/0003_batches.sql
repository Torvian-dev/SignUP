-- Batch sign-ups: one URL × a roster of profiles. One account per profile (the existing
-- UNIQUE(profile_id, domain) guardrail still holds), each with its own email and its own proxy.
-- Fully automatic submission is opt-in per organisation and never loops a single profile.

ALTER TABLE automation_runs ADD COLUMN auto_submit boolean NOT NULL DEFAULT false;
ALTER TABLE org_policies   ADD COLUMN allow_auto_submit boolean NOT NULL DEFAULT false;

CREATE TYPE batch_status AS ENUM ('queued', 'running', 'paused', 'completed', 'cancelled');

CREATE TABLE batches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by       uuid NOT NULL REFERENCES users(id),
  url              text NOT NULL,
  domain           citext NOT NULL,
  intent           text NOT NULL DEFAULT 'signup',
  profile_ids      uuid[] NOT NULL,              -- the roster, in order (deduped at creation)
  quantity         integer NOT NULL,            -- cap: process at most this many profiles
  on_failure       text NOT NULL DEFAULT 'skip' CHECK (on_failure IN ('skip', 'pause')),
  cursor           integer NOT NULL DEFAULT 0,   -- next index into profile_ids
  processed        integer NOT NULL DEFAULT 0,
  succeeded        integer NOT NULL DEFAULT 0,
  failed           integer NOT NULL DEFAULT 0,
  current_run_id   uuid,                         -- the single in-flight run (sequential)
  status           batch_status NOT NULL DEFAULT 'queued',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (quantity BETWEEN 1 AND 1000)
);
CREATE INDEX ON batches (org_id, created_at DESC);

ALTER TABLE automation_runs ADD COLUMN batch_id uuid REFERENCES batches(id) ON DELETE SET NULL;
ALTER TABLE automation_runs ADD COLUMN batch_seq integer;      -- index of this run's profile within the batch
CREATE INDEX ON automation_runs (batch_id);

ALTER TABLE batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON batches
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);

CREATE TRIGGER batches_touch BEFORE UPDATE ON batches FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON batches TO formagent_app;
