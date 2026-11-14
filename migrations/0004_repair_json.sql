-- A JSON value written through the network driver was stored as a string holding JSON text (the driver encoded it a second time),
-- so the accent, team glyphs, photos and link details read back as nothing. Unwrap those values once; rows already right are untouched.
UPDATE settings SET value = (value #>> '{}')::jsonb
  WHERE jsonb_typeof(value) = 'string' AND (value #>> '{}') ~ '^\s*("|\{)';
UPDATE work_links SET meta = (meta #>> '{}')::jsonb
  WHERE jsonb_typeof(meta) = 'string' AND (meta #>> '{}') ~ '^\s*\{';
