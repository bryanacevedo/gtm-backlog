-- Per-install settings: the accent colour and the team colours. One row per key, the value is JSON.
-- A setting change is logged in the activity feed, which belongs to no item, so events.item_id may now be empty.

CREATE TABLE settings (
  key        text PRIMARY KEY CHECK (length(trim(key)) > 0),
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE events ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE events DROP CONSTRAINT events_kind_check;
ALTER TABLE events ADD CONSTRAINT events_kind_check CHECK (kind IN ('created', 'triaged', 'moved', 'edited', 'logged', 'settings'));
