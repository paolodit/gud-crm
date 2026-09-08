# Live projects

Track delivery after a sale, or add work you are already doing.

- **From sales:** an unarchived Won opportunity appears automatically. Contacts and activity remain on the original sales record.
- **Add project:** choose Live projects → Add project. Enter a client label, project name, optional owner and offer, then a delivery stage and milestone. This creates a standalone project, not a Won sale or a company record. It does not increase pipeline value or conversion totals.
- **Edit:** click a project card. Direct projects also let you change the name, client label, owner and offer. Sales-linked projects have an Open full record link for commercial details.
- **Archive:** open the project, choose Archive project, then Confirm archive. This hides delivery only. Use Archive on the live board to find it and Restore project to bring it back. Sales history is preserved.
- **Expand a column:** the column’s expand button switches between one and three card lanes.

## Configure delivery stages

Workspace admins can open Settings → Live projects to rename, describe, recolour, reorder, add or remove stages. Click a stage row to edit it, then choose Save stage. Drag rows or use arrow keys on a drag handle to save a new order. Removing a stage requires a destination and an explicit Move and remove confirmation for all its projects, including archived projects. At least one stage is required. Sales stages use the same editing layout under Settings → Sales.

## Talk through a delivery update

Open a project and choose Talk through an update. Speak or type what has changed, the delivery stage, next milestone and due date. Prepare for review fills only explicitly stated delivery fields; notes are appended to existing notes. Review the form and choose Save project. Nothing changes until you save, and no sales activity or sales-stage change is created. This works for both direct and sales-linked projects and uses the workspace OpenAI connection in Settings → AI & connections.

Reports includes current projects, overdue milestones, missing milestones, archived totals and a stage breakdown. Offer filtering applies to both sales and delivery. The default `complete` stage is excluded from overdue milestone counts.

## Storage and backups

Sales-linked delivery lives on the opportunity. Standalone projects and delivery-stage configuration are workspace-scoped metadata: stored in the SQLite snapshot locally and in the organisation’s settings JSON in PostgreSQL. Database backups include both. PostgreSQL changes hold a workspace lock and are audited against the signed-in member; stage configuration requires admin access.

Back up before upgrading. No new SQL migration is needed for these additions after the existing `0010_live_delivery` migration. Do not downgrade to an earlier release that cannot display direct projects or custom stages without first exporting and checking your data.

## Settings navigation and update setup

Settings is grouped into Workspace, People & access, Sales, Live projects, AI & connections, and Data & updates. Safe updates includes an expandable setup guide for private backup and deployment webhooks. Manual database backup followed by CapRover deployment remains supported; never substitute a dummy success response for a real backup.

MCP can list both project sources and read the configured stage IDs. Direct projects are currently managed through the Live projects screen; the existing `update_live_project` tool remains for sales-linked delivery. See [MCP setup](MCP.md).
