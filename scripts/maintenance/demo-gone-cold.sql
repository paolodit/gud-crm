-- Demo-only addition for an existing deployment. New installs get this from
-- the edition defaults. Take a backup and preview before committing.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $run$
DECLARE
  pipeline record;
  stage record;
  insertion integer;
  added uuid;
BEGIN
  IF current_database() <> 'gud_demo' THEN RAISE EXCEPTION 'This script is restricted to gud_demo'; END IF;
  FOR pipeline IN SELECT id, organisation_id FROM pipelines WHERE active FOR UPDATE LOOP
    PERFORM id FROM stages WHERE pipeline_id = pipeline.id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM stages WHERE pipeline_id = pipeline.id AND lower(btrim(name)) = 'gone cold' AND active) THEN CONTINUE; END IF;
    SELECT COALESCE(MIN(position) FILTER (WHERE active AND terminal_type IN ('won', 'lost')), MAX(position) + 1, 0)
      INTO insertion FROM stages WHERE pipeline_id = pipeline.id;
    -- Descending single-row updates preserve the unique pipeline/position key.
    FOR stage IN SELECT id FROM stages WHERE pipeline_id = pipeline.id AND position >= insertion ORDER BY position DESC LOOP
      UPDATE stages SET position = position + 1, updated_at = now() WHERE id = stage.id;
    END LOOP;
    INSERT INTO stages (pipeline_id, name, colour, position, terminal_type)
      VALUES (pipeline.id, 'Gone Cold', '#98A2B3', insertion, 'nurture') RETURNING id INTO added;
    INSERT INTO audit_events (organisation_id, action, entity_type, entity_id, "after")
      VALUES (pipeline.organisation_id, 'stage.created', 'stage', added::text, jsonb_build_object('name', 'Gone Cold', 'source', 'demo-default-update'));
  END LOOP;
END
$run$;
SELECT p.name AS pipeline, s.name AS stage, s.position, s.terminal_type FROM stages s JOIN pipelines p ON p.id = s.pipeline_id WHERE s.active ORDER BY p.id, s.position;
ROLLBACK;
