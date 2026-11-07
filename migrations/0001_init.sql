-- gtm-backlog schema, PostgreSQL 15+.
-- One table per object in docs/SPEC.md. Nothing is ever deleted: declined and
-- retired are stages, and every change writes an event.

CREATE TYPE stage AS ENUM ('triage', 'idea', 'building', 'live', 'declined', 'retired');

CREATE TABLE items (
  id               text PRIMARY KEY,
  title            text NOT NULL CHECK (length(trim(title)) > 0),
  problem          text NOT NULL CHECK (length(trim(problem)) > 0),
  team             text NOT NULL,
  requester        text NOT NULL,
  touches          text[] NOT NULL DEFAULT '{}',
  link             text,
  stage            stage NOT NULL DEFAULT 'triage',
  owner            text,
  impact           smallint CHECK (impact BETWEEN 1 AND 5),
  reach            numeric CHECK (reach >= 0),                 -- accounts affected per week
  confidence       smallint CHECK (confidence IN (50, 80, 100)),
  effort_days      numeric CHECK (effort_days > 0),
  -- The score is derived, never typed: impact x reach x confidence / effort.
  -- NULL whenever an input is missing, so an unscored item cannot pretend.
  score            numeric GENERATED ALWAYS AS (impact * reach * confidence / 100.0 / effort_days) STORED,
  scored_at        timestamptz,
  scored_by        text,
  system_url       text,
  target_date      date,
  decision_note    text,
  merged_into      text REFERENCES items(id),
  live_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  stage_changed_at timestamptz NOT NULL DEFAULT now(),
  -- Rules the database holds even if the API is bypassed.
  CONSTRAINT live_needs_system CHECK (stage <> 'live' OR system_url IS NOT NULL),
  CONSTRAINT closed_needs_reason CHECK (stage NOT IN ('declined', 'retired') OR decision_note IS NOT NULL),
  CONSTRAINT no_self_merge CHECK (merged_into IS NULL OR merged_into <> id)
);
CREATE INDEX items_stage_score ON items (stage, score DESC NULLS LAST, created_at);

CREATE TABLE ship_log (
  id         text PRIMARY KEY,
  item_id    text NOT NULL REFERENCES items(id),
  date       date NOT NULL CHECK (date <= current_date),
  metric     text NOT NULL,
  value      numeric NOT NULL,
  unit       text NOT NULL,
  note       text,
  source_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ship_log_item_date ON ship_log (item_id, date DESC);

CREATE TABLE events (
  id      text PRIMARY KEY,
  item_id text NOT NULL REFERENCES items(id),
  at      timestamptz NOT NULL DEFAULT now(),
  actor   text NOT NULL,
  kind    text NOT NULL CHECK (kind IN ('created', 'triaged', 'moved', 'edited', 'logged')),
  detail  text NOT NULL
);
CREATE INDEX events_item_at ON events (item_id, at DESC);
CREATE INDEX events_at ON events (at DESC);

-- The Queue, ranked the way docs/SPEC.md says: scored items by score, then
-- unscored items oldest first. The app ranks the same way client-side for
-- optimistic updates; this view is the reference.
CREATE VIEW queue AS
SELECT i.*,
       row_number() OVER (ORDER BY i.score DESC NULLS LAST, i.created_at) AS rank
FROM items i
WHERE i.stage IN ('idea', 'building');

-- Shipped: one row per item that has ever gone live, with its latest result.
CREATE VIEW shipped AS
SELECT i.id, i.title, i.team, i.owner, i.stage, i.system_url, i.live_at,
       l.date AS last_result_date, l.metric, l.value, l.unit,
       (SELECT count(*) FROM ship_log s WHERE s.item_id = i.id) AS results
FROM items i
LEFT JOIN LATERAL (
  SELECT date, metric, value, unit FROM ship_log s
  WHERE s.item_id = i.id ORDER BY date DESC, created_at DESC LIMIT 1
) l ON true
WHERE i.live_at IS NOT NULL;
