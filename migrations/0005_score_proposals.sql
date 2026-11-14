-- Proposed scores for a request in triage, kept apart from the values a person accepts. A proposal records who made it (the model
-- and the prompt version, or a sample stand-in in the demo), one reason per input, and which inputs are guesses. When the request
-- leaves triage, the values it was given are copied into accepted_* and the outcome says whether they were taken as proposed.
-- Resolved rows are the examples the next proposals learn from.

CREATE TABLE score_proposals (
  id               text PRIMARY KEY,
  item_id          text NOT NULL REFERENCES items(id),
  impact           integer NOT NULL CHECK (impact BETWEEN 1 AND 5),
  reach            double precision NOT NULL CHECK (reach >= 0),
  confidence       integer NOT NULL CHECK (confidence IN (50, 80, 100)),
  effort_days      double precision NOT NULL CHECK (effort_days > 0),
  reason_impact     text NOT NULL,
  reason_reach      text NOT NULL,
  reason_confidence text NOT NULL,
  reason_effort     text NOT NULL,
  guesses          text[] NOT NULL DEFAULT '{}',
  source           text NOT NULL CHECK (source IN ('claude', 'stand-in')),
  model            text NOT NULL,
  prompt_version   text NOT NULL,
  examples_used    integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  outcome          text CHECK (outcome IN ('accepted', 'adjusted', 'declined')),
  accepted_impact      integer,
  accepted_reach       double precision,
  accepted_confidence  integer,
  accepted_effort_days double precision
);
CREATE INDEX score_proposals_item ON score_proposals (item_id, created_at DESC);
CREATE INDEX score_proposals_resolved ON score_proposals (resolved_at DESC) WHERE resolved_at IS NOT NULL;
