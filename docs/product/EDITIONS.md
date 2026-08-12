# Sales models and private instances

Sales-model configuration lives in `src/lib/editions`. It supplies defaults and language while the CRM core stays shared.

## Focused Sales

- Best for one product, a SaaS offer or a tightly connected product family.
- Default pipeline: Focused Sales.
- Language: companies, contacts, products and customer handoff.
- Product context stays quiet because most opportunities share the same offer.
- Pre-pipeline navigation opens directly on **Targets**; market-idea research stays hidden.

## Service Sales

- Best for consultancies, agencies and independent specialists.
- Default pipeline: Service Sales.
- Language: organisations, people, services and client handoff.
- Several active services reveal contextual filters and labels only where they help.
- **Ideas** is available in both editions for market needs, sector signals, campaigns, partnerships or service angles; **Targets** separately holds named organisations, evidence, provisional opportunities and contacts.

## What changing a sales model does

Changing the model updates product guidance and terminology. It deliberately does not rewrite existing stages, offers, companies, opportunities or activity history. Admins can then add, edit or remove visible sales stages deliberately; removal always asks where existing opportunities should move. Targets' two pre-pipeline buckets remain protected.

## Instance boundary

Run every real organisation as a separate instance with its own database, secrets, users, uploads, backups and deployment configuration. A Focused Sales instance may contain any single-product business's private operating data; a Service Sales instance may contain any agency's private data. Neither organisation identity belongs in the generic code or fixtures.

One repository and one application image are enough. Separate codebases would create drift without adding isolation; separate databases and deployments provide the required isolation.

## Public demonstrations

The repository includes two deliberately fictional fixture snapshots:

- `npm run demo:focused` demonstrates a one-product pipeline;
- `npm run demo:service` demonstrates several kinds of service in one coherent pipeline.

Demo mode does not open or seed a private database. A new persistent SQLite or PostgreSQL workspace starts clean, so sample opportunities cannot be mistaken for operating data.
