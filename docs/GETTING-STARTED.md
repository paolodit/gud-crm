# Getting started

GUD CRM is designed to become useful before it becomes configurable. Start with one offer and one shared pipeline; add complexity only when the work genuinely needs it.

## Choose the right runtime

| Use | Runtime | Login boundary |
| --- | --- | --- |
| Development, evaluation and shaping the workflow | SQLite | One trusted local admin session; not authentication |
| Resetting public demonstration | Demo | No persistent data and no authentication |
| Live team use | PostgreSQL | Separate Better Auth accounts, roles and revocable sessions |

Never expose the SQLite or demo runtime to the public internet. They deliberately skip individual authentication.

Use `npm run demo:focused` for the fictional single-product journey or `npm run demo:service` for the fictional multi-service journey. Use `npm run dev` or `npm run dev:instance -- <name>` for a clean persistent workspace.

## Choose a sales model

- Use **Focused Sales** when most opportunities sell one product, SaaS offer or tightly connected product family.
- Use **Service Sales** when the same organisation pitches several materially different projects, retainers or advisory services.

This is workspace configuration, not a separate application version. A real organisation is a private instance with its own database and secrets.

## A clean 15-minute setup

1. Install dependencies and run `npm run dev`.
2. Open `http://localhost:3000` and choose **Open local workspace**.
3. Begin on **Today**. This shows the next moves and overall momentum; the full pipeline is one click away.
4. In **Settings**, choose the sales model and rename the pipeline.
5. Review **Offers**. Keep one offer for the cleanest experience. Add a second only when the team is actively pitching another kind of work.
6. Review the team and roles: admin, manager and sales support. Local changes prepare the roster; separate passwords start with PostgreSQL.
7. Review the activity types. Use language the team will actually log consistently.
8. In **Playbook**, record which sales assets are ready, missing or owned by somebody.
9. Add an organisation manually, import a validated tracker, or bring a structured research pack into **Research**.
10. Download a SQLite backup after the first meaningful setup session.

## The minimum useful record

An opportunity becomes workable when it has:

- a real organisation and the offer being pitched;
- an owner;
- a credible person or contact route;
- one useful observation or reason for relevance;
- an honest stage;
- one owned, dated next action.

Do not fill fields for their own sake. GUD is healthy when the next decision is clear and the relationship history is trustworthy.

## Adding another service

Use **Settings → Offers → Add offer**. Add a clear description, ideal customer and positioning. GUD then reveals offer selectors only where mixed context matters. Existing records remain attached to their current offer and are not duplicated.

## Before inviting a live team

Use the readiness strip at the top of Settings, then complete the production checklist in the main README. A live workspace is not ready until PostgreSQL authentication has passed `npm run auth:smoke`, the recovery sender is configured, backups exist and a restore has been tested.
