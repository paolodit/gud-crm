-- One-off, Refresh ONLY. Take a fresh backup first and deploy checklist support.
-- Preview is the default: the final ROLLBACK leaves all data unchanged.
-- After reviewing the counts, run the same script with final ROLLBACK replaced
-- by COMMIT. This is never run automatically by application migrations.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION pg_temp.delivery_bullets_to_tasks(details jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE
  line text;
  task_text text;
  remaining text[] := ARRAY[]::text[];
  checklist jsonb := COALESCE(NULLIF(details->'tasks', 'null'::jsonb), '[]'::jsonb);
  added integer := 0;
BEGIN
  IF jsonb_typeof(checklist) <> 'array' THEN RAISE EXCEPTION 'Existing tasks must be an array'; END IF;
  FOREACH line IN ARRAY regexp_split_to_array(COALESCE(details->>'notes', ''), E'\r?\n') LOOP
    IF line ~ '^[[:space:]]*-[[:space:]]+[^[:space:]]' THEN
      task_text := btrim(regexp_replace(line, '^[[:space:]]*-[[:space:]]+', ''));
      IF length(task_text) > 500 THEN RAISE EXCEPTION 'Task exceeds 500 characters; review manually'; END IF;
      checklist := checklist || jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'text', task_text, 'completed', false));
      added := added + 1;
    ELSE
      remaining := array_append(remaining, line);
    END IF;
  END LOOP;
  IF jsonb_array_length(checklist) > 200 THEN RAISE EXCEPTION 'Project exceeds 200 tasks; review manually'; END IF;
  IF added = 0 THEN RETURN details; END IF;
  RETURN details || jsonb_build_object('notes', COALESCE(array_to_string(remaining, E'\n'), ''), 'tasks', checklist);
END
$fn$;

CREATE TEMP TABLE conversion_result (project_count integer, task_count integer, already_done boolean) ON COMMIT DROP;
DO $run$
DECLARE
  org record;
  sale record;
  project jsonb;
  projects jsonb;
  changed jsonb;
  project_count integer;
  task_count integer;
  old_count integer;
BEGIN
  IF current_database() <> 'gud_refresh' THEN RAISE EXCEPTION 'This one-off conversion is restricted to gud_refresh'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('refresh-delivery-tasks-v1'));
  FOR org IN SELECT id, settings FROM organisations FOR UPDATE LOOP
    IF org.settings ? 'deliveryTasksConvertedV1' THEN
      INSERT INTO conversion_result VALUES (0, 0, true);
      CONTINUE;
    END IF;
    projects := '[]'::jsonb; project_count := 0; task_count := 0;
    FOR project IN SELECT value FROM jsonb_array_elements(COALESCE(org.settings->'directProjects', '[]'::jsonb)) LOOP
      IF NULLIF(project->'delivery'->>'archivedAt', '') IS NULL THEN
        changed := pg_temp.delivery_bullets_to_tasks(COALESCE(project->'delivery', '{}'::jsonb));
        IF changed IS DISTINCT FROM COALESCE(project->'delivery', '{}'::jsonb) THEN
          old_count := jsonb_array_length(COALESCE(NULLIF(project->'delivery'->'tasks', 'null'::jsonb), '[]'::jsonb));
          task_count := task_count + jsonb_array_length(changed->'tasks') - old_count;
          project_count := project_count + 1;
          INSERT INTO audit_events (organisation_id, action, entity_type, entity_id, "before", "after")
            VALUES (org.id, 'delivery.notes_converted_to_tasks', 'direct_project', project->>'id', jsonb_build_object('delivery', project->'delivery'), jsonb_build_object('delivery', changed));
          project := jsonb_set(project, '{delivery}', changed);
        END IF;
      END IF;
      projects := projects || jsonb_build_array(project);
    END LOOP;
    FOR sale IN SELECT o.id, o.delivery FROM opportunities o
      JOIN stages s ON s.id = o.stage_id JOIN companies c ON c.id = o.company_id
      WHERE o.organisation_id = org.id AND c.organisation_id = org.id
        AND s.terminal_type = 'won' AND o.archived_at IS NULL AND c.archived_at IS NULL
        AND NULLIF(o.delivery->>'archivedAt', '') IS NULL FOR UPDATE OF o LOOP
      changed := pg_temp.delivery_bullets_to_tasks(COALESCE(sale.delivery, '{}'::jsonb));
      IF changed IS DISTINCT FROM COALESCE(sale.delivery, '{}'::jsonb) THEN
        old_count := jsonb_array_length(COALESCE(NULLIF(sale.delivery->'tasks', 'null'::jsonb), '[]'::jsonb));
        task_count := task_count + jsonb_array_length(changed->'tasks') - old_count;
        project_count := project_count + 1;
        INSERT INTO audit_events (organisation_id, action, entity_type, entity_id, "before", "after")
          VALUES (org.id, 'delivery.notes_converted_to_tasks', 'opportunity', sale.id::text, jsonb_build_object('delivery', sale.delivery), jsonb_build_object('delivery', changed));
        UPDATE opportunities SET delivery = changed, updated_at = now() WHERE id = sale.id AND organisation_id = org.id;
      END IF;
    END LOOP;
    UPDATE organisations SET settings = settings || jsonb_build_object('directProjects', projects, 'deliveryTasksConvertedV1', now()), updated_at = now() WHERE id = org.id;
    INSERT INTO conversion_result VALUES (project_count, task_count, false);
  END LOOP;
END
$run$;
SELECT SUM(project_count) AS projects_converted, SUM(task_count) AS tasks_added, bool_and(already_done) AS already_completed FROM conversion_result;
ROLLBACK;
