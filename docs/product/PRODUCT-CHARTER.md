# GUD Sales Workspace product charter

GUD is one focused sales system with two configurable sales models:

- **Focused Sales** is for a single product, SaaS offer or tightly connected product family.
- **Service Sales** is for consultancies, agencies and specialists pitching several kinds of project, retainer or advisory engagement.

Both models use the same application, data model, migrations, security controls and release pipeline. Their differences are configuration: language, default stages, offer behaviour, qualification guidance, suggested actions, playbook content and enrichment routes.

Private organisations are deployments, not source-code editions. Their company names, users, prospects, contacts, activity, research and credentials belong only in ignored local databases or separately secured production databases.

## Product boundary

GUD begins with a potential prospect and ends with a won opportunity and a clear client handoff. It does not manage project delivery, invoicing, support, renewals or the wider customer lifecycle.

> A focused sales workspace that helps businesses understand their prospects, choose the next action and turn opportunities into revenue—without the complexity of a traditional CRM.

The product must always answer three questions quickly:

1. What opportunities do we actually have?
2. Which ones deserve attention?
3. What should we do next?

Research, enrichment and AI support those answers. They are not the centre of the product.

## Product principles

- Start useful; reveal configuration only when needed.
- Keep one company and its people connected to several possible pitches.
- Treat the next action as first-class data.
- Keep pipeline progress separate from activity history.
- Show commercial value without pretending forecasts are facts.
- Require human judgement before outreach, enrichment writes or AI-derived actions.
- Preserve a clean export and client handoff at the end of the sales process.
- Never place operating customer or prospect data in the source repository.
