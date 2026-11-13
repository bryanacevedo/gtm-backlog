-- The work behind a build: its repository and branch, pull requests, Claude sessions, commits and docs, each one pasted link.
-- A pull request's state is a plain word; the rest have none. Results may now be logged from Building onward, which the
-- API enforces (ship_log has never had a stage rule in the schema, so nothing changes there).

CREATE TABLE work_links (
  id         text PRIMARY KEY,
  item_id    text NOT NULL REFERENCES items(id),
  kind       text NOT NULL CHECK (kind IN ('repo', 'pr', 'session', 'commit', 'doc')),
  url        text NOT NULL CHECK (url ~ '^https?://'),
  title      text NOT NULL CHECK (length(trim(title)) > 0),
  state      text CHECK (state IN ('open', 'merged', 'closed')),
  meta       jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  CONSTRAINT state_only_on_pr CHECK (state IS NULL OR kind = 'pr'),
  CONSTRAINT one_link_per_item UNIQUE (item_id, url)
);
CREATE INDEX work_links_item ON work_links (item_id, created_at DESC);
