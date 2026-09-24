-- Fictional examples only. Back up first. Default execution is a ROLLBACK preview.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $run$
DECLARE
  workspace record;
  pipe uuid; owner_id_value text; offer_id_value uuid; stage_id_value uuid;
  company_id_value uuid; contact_id_value uuid; opportunity_id_value uuid; note_type uuid;
  row_data record; projects jsonb; details jsonb; task_items jsonb; due_at_value timestamptz;
  marker constant text := 'demoExpansion20260924';
BEGIN
  IF current_database() <> 'gud_demo' THEN RAISE EXCEPTION 'This script is restricted to gud_demo'; END IF;
  SELECT * INTO STRICT workspace FROM organisations WHERE name = 'GUD CRM Demo' FOR UPDATE;
  IF workspace.settings ? marker THEN RAISE NOTICE 'Demo expansion already applied; no changes'; RETURN; END IF;
  SELECT id INTO STRICT pipe FROM pipelines WHERE organisation_id = workspace.id AND active;
  SELECT id INTO owner_id_value FROM users WHERE organisation_id = workspace.id AND active AND role = 'admin' ORDER BY created_at, id LIMIT 1;
  IF owner_id_value IS NULL THEN RAISE EXCEPTION 'Demo needs an active admin owner'; END IF;
  SELECT id INTO note_type FROM activity_types WHERE organisation_id = workspace.id AND active AND channel = 'note' ORDER BY name LIMIT 1;
  IF note_type IS NULL THEN RAISE EXCEPTION 'Demo needs a note activity type'; END IF;
  projects := COALESCE(workspace.settings->'directProjects', '[]'::jsonb);
  IF jsonb_typeof(projects) <> 'array' THEN RAISE EXCEPTION 'Unexpected direct-project storage'; END IF;
  IF workspace.settings ? 'deliveryStages' AND EXISTS (
    SELECT 1 FROM unnest(ARRAY['kickoff','in_progress','client_review','on_hold']) expected(id)
    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(workspace.settings->'deliveryStages') s WHERE s->>'id' = expected.id)
  ) THEN RAISE EXCEPTION 'Required demo delivery stages are missing'; END IF;

  FOR row_data IN SELECT * FROM (VALUES
    ('Willow Bakery', 'Online orders and collection', 'Outreach active', 'Website project', 4800, 'Mia Green', 'Discuss the collection journey', 2),
    ('Beacon Cycle Works', 'Workshop booking website', 'Outreach active', 'Website project', 6500, 'Sam Reed', 'Call about workshop bookings', 3),
    ('Maple Learning Studio', 'New course launch', 'Outreach active', 'Growth retainer', 7200, 'Alex Vale', 'Share a launch outline', 4),
    ('Copper Finch Hotel', 'Direct booking experience', 'Conversation active', 'Visitor experience', 12500, 'Robin Lane', 'Review guest booking priorities', 1),
    ('Juniper Health Studio', 'Membership growth campaign', 'Conversation active', 'Growth retainer', 9600, 'Taylor Brook', 'Confirm the pilot audience', 3),
    ('Orchard Makers', 'Trade enquiry website', 'Conversation active', 'Website project', 8200, 'Charlie Wood', 'Map the trade enquiry form', 5),
    ('Cobalt Adventure Park', 'Visitor planning experience', 'Proposal / decision', 'Visitor experience', 18000, 'Morgan Ash', 'Walk through the proposal', 2),
    ('Paper Kite Publishing', 'Reader subscription launch', 'Proposal / decision', 'Website project', 11000, 'Jamie Park', 'Confirm scope and launch date', 4),
    ('Meadow Mobility', 'Quarterly growth programme', 'Proposal / decision', 'Growth retainer', 14400, 'Casey Hill', 'Discuss the first quarter plan', 6),
    ('Silver Birch Gallery', 'Exhibition microsite', 'Gone Cold', 'Website project', 5400, 'Drew Lake', 'Check next exhibition timing', 21),
    ('Little Lantern Museum', 'Visitor website rebuild', 'Won', 'Visitor experience', 16000, 'Rowan Fox', 'Approve the visitor journey', 7),
    ('Harbour Thread Clothing', 'Ecommerce refresh', 'Won', 'Website project', 13500, 'Avery Stone', 'Review the product templates', 10),
    ('Solstice Coffee Roasters', 'Monthly growth support', 'Won', 'Growth retainer', 12000, 'Jules Oak', 'Approve the next campaign', 5)
  ) AS example(company, title, stage, offer, amount, contact, next_move, days) LOOP
    SELECT id INTO STRICT stage_id_value FROM stages WHERE pipeline_id = pipe AND active AND lower(name) = lower(row_data.stage);
    SELECT id INTO STRICT offer_id_value FROM offers WHERE organisation_id = workspace.id AND active AND name = row_data.offer;
    due_at_value := ((CURRENT_DATE + row_data.days)::timestamp + interval '10 hours') AT TIME ZONE 'Europe/London';
    INSERT INTO companies (organisation_id, name, normalised_name, sector, research_note, import_metadata)
      VALUES (workspace.id, row_data.company, lower(row_data.company), 'Fictional demo business', 'Fictional training example, not a real prospect.', jsonb_build_object('demoExample', true, 'batch', marker)) RETURNING id INTO company_id_value;
    INSERT INTO contacts (organisation_id, company_id, name, normalised_name, title, email, source)
      VALUES (workspace.id, company_id_value, row_data.contact, lower(row_data.contact), 'Demo decision maker', lower(replace(row_data.contact, ' ', '.')) || '@fictional.example', 'Fictional demo example') RETURNING id INTO contact_id_value;
    details := NULL;
    IF row_data.stage = 'Won' THEN
      details := jsonb_build_object('stage', 'in_progress', 'projectValue', row_data.amount, 'nextMilestone', row_data.next_move, 'dueDate', to_char(CURRENT_DATE + row_data.days, 'YYYY-MM-DD'), 'notes', 'Fictional delivery example. Try a voice update.', 'tasks', jsonb_build_array(
        jsonb_build_object('id', gen_random_uuid(), 'text', 'Complete kickoff and agree scope', 'completed', true),
        jsonb_build_object('id', gen_random_uuid(), 'text', row_data.next_move, 'completed', false),
        jsonb_build_object('id', gen_random_uuid(), 'text', 'Prepare the next delivery review', 'completed', false)));
    END IF;
    INSERT INTO opportunities (organisation_id, pipeline_id, offer_id, company_id, stage_id, position, owner_id, title, value, probability, temperature, outreach_angle, next_action_at, last_activity_at, delivery, import_metadata)
      VALUES (workspace.id, pipe, offer_id_value, company_id_value, stage_id_value,
        (SELECT COALESCE(max(position), -1) + 1 FROM opportunities WHERE stage_id = stage_id_value), owner_id_value, row_data.title, row_data.amount,
        CASE row_data.stage WHEN 'Won' THEN 100 WHEN 'Proposal / decision' THEN 70 WHEN 'Conversation active' THEN 40 ELSE 15 END,
        CASE WHEN row_data.stage IN ('Won', 'Proposal / decision') THEN 'hot'::temperature ELSE 'warm'::temperature END,
        'Fictional demo opportunity: ' || row_data.next_move, CASE WHEN row_data.stage <> 'Won' THEN due_at_value END, now(), details,
        jsonb_build_object('demoExample', true, 'batch', marker)) RETURNING id INTO opportunity_id_value;
    INSERT INTO opportunity_contacts (opportunity_id, contact_id, "primary") VALUES (opportunity_id_value, contact_id_value, true);
    INSERT INTO activities (organisation_id, opportunity_id, company_id, contact_id, activity_type_id, notes, occurred_at, created_by_id)
      VALUES (workspace.id, opportunity_id_value, company_id_value, contact_id_value, note_type, 'Fictional scenario: ' || row_data.next_move || '. No real contact has taken place.', now(), owner_id_value);
    IF row_data.stage <> 'Won' THEN
      INSERT INTO tasks (organisation_id, opportunity_id, contact_id, owner_id, title, due_at, source)
        VALUES (workspace.id, opportunity_id_value, contact_id_value, owner_id_value, row_data.next_move, due_at_value, 'demo-example');
    END IF;
  END LOOP;

  FOR row_data IN SELECT * FROM (VALUES
    ('Pebble & Pine', 'Brand and website kickoff', 'kickoff', 'Website project', 6800, 'Agree the creative brief', 5),
    ('North Meadow Theatre', 'Season campaign', 'in_progress', 'Growth retainer', 9000, 'Review campaign concepts', 7),
    ('Tidepool Visitor Centre', 'Interactive visitor map', 'client_review', 'Visitor experience', 14500, 'Approve the map prototype', 3),
    ('Kestrel Homewares', 'Product photography and shop', 'on_hold', 'Website project', 7500, 'Confirm product samples are ready', 14),
    ('Honeycomb Co-working', 'Member newsletter programme', 'in_progress', 'Growth retainer', 6000, 'Email 4', 4)
  ) AS example(company, title, stage, offer, amount, milestone, days) LOOP
    SELECT id INTO STRICT offer_id_value FROM offers WHERE organisation_id = workspace.id AND active AND name = row_data.offer;
    task_items := CASE WHEN row_data.milestone = 'Email 4' THEN jsonb_build_array(
      jsonb_build_object('id', gen_random_uuid(), 'text', 'Email 1', 'completed', true),
      jsonb_build_object('id', gen_random_uuid(), 'text', 'Email 2', 'completed', true),
      jsonb_build_object('id', gen_random_uuid(), 'text', 'Email 3', 'completed', true),
      jsonb_build_object('id', gen_random_uuid(), 'text', 'Email 4', 'completed', false)) ELSE jsonb_build_array(
      jsonb_build_object('id', gen_random_uuid(), 'text', 'Agree scope and responsibilities', 'completed', true),
      jsonb_build_object('id', gen_random_uuid(), 'text', row_data.milestone, 'completed', false),
      jsonb_build_object('id', gen_random_uuid(), 'text', 'Plan the next review', 'completed', false)) END;
    projects := projects || jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'title', row_data.title, 'companyName', row_data.company, 'ownerId', owner_id_value, 'offerId', offer_id_value,
      'delivery', jsonb_build_object('stage', row_data.stage, 'projectValue', row_data.amount, 'nextMilestone', row_data.milestone, 'dueDate', to_char(CURRENT_DATE + row_data.days, 'YYYY-MM-DD'), 'notes', 'Fictional demo project. Safe to experiment with.', 'tasks', task_items)));
  END LOOP;
  UPDATE organisations SET settings = jsonb_set(jsonb_set(COALESCE(settings, '{}'::jsonb), '{directProjects}', projects), ARRAY[marker], jsonb_build_object('appliedAt', now(), 'opportunitiesAdded', 13, 'directProjectsAdded', 5)), updated_at = now() WHERE id = workspace.id;
  INSERT INTO audit_events (organisation_id, actor_id, action, entity_type, entity_id, "after")
    VALUES (workspace.id, owner_id_value, 'demo.examples.added', 'organisation', workspace.id::text, jsonb_build_object('batch', marker, 'opportunitiesAdded', 13, 'directProjectsAdded', 5));
END
$run$;
SELECT (SELECT count(*) FROM opportunities WHERE import_metadata->>'batch' = 'demoExpansion20260924') AS added_opportunities,
       jsonb_array_length(settings->'directProjects') AS total_direct_projects
FROM organisations WHERE name = 'GUD CRM Demo';
ROLLBACK;
