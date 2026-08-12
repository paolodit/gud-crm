-- Keep the two pre-pipeline Target stages. Consolidate only the visible sales board.
WITH pipeline_stage_map AS (
  SELECT
    p.id AS pipeline_id,
    MAX(CASE WHEN s.name = 'Researching' AND s.active THEN s.id::text END)::uuid AS researching_id,
    MAX(CASE WHEN s.name = 'Outreach active' AND s.active THEN s.id::text END)::uuid AS outreach_id,
    COALESCE(
      MAX(CASE WHEN s.name = 'Conversation active' AND s.active THEN s.id::text END)::uuid,
      MAX(CASE WHEN s.name = 'Engaged' AND s.active THEN s.id::text END)::uuid,
      MAX(CASE WHEN s.name = 'Discovery booked' AND s.active THEN s.id::text END)::uuid,
      MAX(CASE WHEN s.name = 'Review booked' AND s.active THEN s.id::text END)::uuid
    ) AS conversation_id,
    COALESCE(
      MAX(CASE WHEN s.name = 'Proposal / decision' AND s.active THEN s.id::text END)::uuid,
      MAX(CASE WHEN s.name = 'Proposal sent' AND s.active THEN s.id::text END)::uuid,
      MAX(CASE WHEN s.name = 'Pilot proposed' AND s.active THEN s.id::text END)::uuid,
      MAX(CASE WHEN s.name = 'Trial proposed' AND s.active THEN s.id::text END)::uuid,
      MAX(CASE WHEN s.name IN ('Decision pending', 'Pilot active', 'Trial active') AND s.active THEN s.id::text END)::uuid
    ) AS proposal_id
  FROM pipelines p
  JOIN stages s ON s.pipeline_id = p.id
  WHERE p.active = true
  GROUP BY p.id
)
UPDATE opportunities o
SET
  stage_id = CASE
    WHEN source.name = 'Ready to contact' THEN map.researching_id
    WHEN source.name IN ('Engaged', 'Conversation active', 'Discovery booked', 'Review booked') THEN map.conversation_id
    WHEN source.name IN ('Pilot proposed', 'Pilot active', 'Trial proposed', 'Trial active', 'Proposal sent', 'Decision pending') THEN map.proposal_id
    WHEN source.name = 'Nurture' THEN map.conversation_id
    ELSE o.stage_id
  END,
  updated_at = now()
FROM stages source, pipeline_stage_map map
WHERE o.stage_id = source.id
  AND o.pipeline_id = map.pipeline_id
  AND source.name IN ('Ready to contact', 'Engaged', 'Conversation active', 'Discovery booked', 'Review booked', 'Pilot proposed', 'Pilot active', 'Trial proposed', 'Trial active', 'Proposal sent', 'Decision pending', 'Nurture')
  AND CASE
    WHEN source.name = 'Ready to contact' THEN map.researching_id
    WHEN source.name IN ('Engaged', 'Conversation active', 'Discovery booked', 'Review booked', 'Nurture') THEN map.conversation_id
    ELSE map.proposal_id
  END IS NOT NULL;--> statement-breakpoint

-- Pick stable representatives, then give the consolidated outcomes clear names.
WITH representatives AS (
  SELECT
    p.id AS pipeline_id,
    COALESCE(
      MAX(CASE WHEN s.name = 'Conversation active' AND s.active THEN s.id::text END)::uuid,
      MAX(CASE WHEN s.name = 'Engaged' AND s.active THEN s.id::text END)::uuid,
      MAX(CASE WHEN s.name = 'Discovery booked' AND s.active THEN s.id::text END)::uuid,
      MAX(CASE WHEN s.name = 'Review booked' AND s.active THEN s.id::text END)::uuid
    ) AS conversation_id,
    COALESCE(
      MAX(CASE WHEN s.name = 'Proposal / decision' AND s.active THEN s.id::text END)::uuid,
      MAX(CASE WHEN s.name = 'Proposal sent' AND s.active THEN s.id::text END)::uuid,
      MAX(CASE WHEN s.name = 'Pilot proposed' AND s.active THEN s.id::text END)::uuid,
      MAX(CASE WHEN s.name = 'Trial proposed' AND s.active THEN s.id::text END)::uuid,
      MAX(CASE WHEN s.name IN ('Decision pending', 'Pilot active', 'Trial active') AND s.active THEN s.id::text END)::uuid
    ) AS proposal_id
  FROM pipelines p
  JOIN stages s ON s.pipeline_id = p.id
  WHERE p.active = true
  GROUP BY p.id
)
UPDATE stages s
SET
  name = CASE WHEN s.id = r.conversation_id THEN 'Conversation active' ELSE 'Proposal / decision' END,
  colour = CASE WHEN s.id = r.conversation_id THEN '#00A86B' ELSE '#D98200' END,
  terminal_type = 'open',
  active = true,
  updated_at = now()
FROM representatives r
WHERE s.id IN (r.conversation_id, r.proposal_id);--> statement-breakpoint

-- Shift every stage beyond its pipeline's current range before reindexing. This also
-- keeps positions collision-free when a workspace already has archived custom stages.
WITH bounds AS (
  SELECT pipeline_id, MIN(position) AS min_position, MAX(position) AS max_position
  FROM stages
  GROUP BY pipeline_id
)
UPDATE stages s
SET position = s.position + (bounds.max_position - bounds.min_position) + 100000
FROM bounds
WHERE s.pipeline_id = bounds.pipeline_id;--> statement-breakpoint

WITH representatives AS (
  SELECT
    p.id AS pipeline_id,
    COALESCE(MAX(CASE WHEN s.name = 'Conversation active' AND s.active THEN s.id::text END)::uuid, MAX(CASE WHEN s.name = 'Engaged' AND s.active THEN s.id::text END)::uuid, MAX(CASE WHEN s.name IN ('Discovery booked', 'Review booked') AND s.active THEN s.id::text END)::uuid) AS conversation_id,
    COALESCE(MAX(CASE WHEN s.name = 'Proposal / decision' AND s.active THEN s.id::text END)::uuid, MAX(CASE WHEN s.name IN ('Proposal sent', 'Pilot proposed', 'Trial proposed') AND s.active THEN s.id::text END)::uuid) AS proposal_id
  FROM pipelines p
  JOIN stages s ON s.pipeline_id = p.id
  WHERE p.active = true
  GROUP BY p.id
)
UPDATE stages s
SET active = false, updated_at = now()
FROM representatives r
WHERE s.pipeline_id = r.pipeline_id
  AND s.name IN ('Ready to contact', 'Engaged', 'Conversation active', 'Discovery booked', 'Review booked', 'Pilot proposed', 'Pilot active', 'Trial proposed', 'Trial active', 'Proposal sent', 'Decision pending', 'Nurture')
  AND s.id NOT IN (r.conversation_id, r.proposal_id);--> statement-breakpoint

WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY pipeline_id
    ORDER BY CASE name
      WHEN 'Researching' THEN 0
      WHEN 'Research holding' THEN 1
      WHEN 'Outreach active' THEN 2
      WHEN 'Conversation active' THEN 3
      WHEN 'Proposal / decision' THEN 4
      WHEN 'Won' THEN 5
      WHEN 'Lost' THEN 6
      ELSE 7
    END, position, id
  ) * 1000 AS next_position
  FROM stages
  WHERE active = true
)
UPDATE stages s
SET position = ranked.next_position, updated_at = now()
FROM ranked
WHERE s.id = ranked.id;--> statement-breakpoint

-- Merged columns can contain cards with the same former position. Give each card a stable order.
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY stage_id
    ORDER BY position, updated_at, id
  ) * 1000 AS next_position
  FROM opportunities
)
UPDATE opportunities o
SET position = ranked.next_position, updated_at = now()
FROM ranked
WHERE o.id = ranked.id;
