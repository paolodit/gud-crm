# Free hosting: Render + Neon

This is the shortest hosted route for trying a private, persistent GUD CRM workspace without administering a server.

- **Render** runs the existing Docker image as a web service.
- **Neon** holds the PostgreSQL database, separately from Render's temporary filesystem.
- **GUD** applies committed migrations, creates the first administrator once, and then starts the application.

It is a good personal workspace or evaluation setup. It is not the recommended home for important day-to-day sales data: free services sleep, the first request can be slow, free allowances can change and neither service replaces a tested backup plan.

## What you need

- A free [Neon account](https://console.neon.tech/)
- A free [Render account](https://dashboard.render.com/)
- An administrator name, email address and unique password of at least 12 characters
- About 15 minutes; the first Docker build takes most of that time

You do not need to install Node.js, Docker or PostgreSQL on your computer.

## 1. Create the database

1. In Neon, create a project in a region near Render's Frankfurt region.
2. Open **Connect** and enable **Connection pooling**.
3. Copy the complete pooled connection string. It should begin with `postgresql://`, use a hostname containing `-pooler`, and include Neon's TLS parameters.
4. Save it in your password manager. Do not put it in GitHub, a screenshot or a support message.

Use Neon rather than Render's free PostgreSQL for this route. Render's free database currently expires after 30 days, whereas the GUD web container can be replaced safely because it stores CRM data in Neon.

## 2. Deploy GUD

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Fpaolodit%2Fgud-crm)

Render reads the root [`render.yaml`](../render.yaml), shows the resources it will create, and asks for four private values:

| Variable | Enter |
| --- | --- |
| `DATABASE_URL` | The complete pooled Neon connection string |
| `SEED_ADMIN_NAME` | The first administrator's real name |
| `SEED_ADMIN_EMAIL` | The email they will use to sign in |
| `SEED_ADMIN_PASSWORD` | A new password of at least 12 characters |

Approve the Blueprint and wait for the web service to become **Live**. The package deliberately creates no Render database, disk, worker or paid resource. Auto-deploy is off so a future commit to the public GUD repository cannot unexpectedly redeploy somebody else's workspace.

Render supplies `RENDER_EXTERNAL_URL` to the container. GUD uses that HTTPS origin for Better Auth automatically, so there is no hostname to guess during the first deployment.

## 3. Sign in and close bootstrap

1. Open the service's `onrender.com` URL.
2. Sign in with the administrator email and password entered above.
3. Confirm that Pipeline, Settings and one small write action work.
4. In Render, open the service's **Environment** page.
5. Change `GUD_BOOTSTRAP` from `if-empty` to `off`.
6. Delete `SEED_ADMIN_PASSWORD`, save and deploy the existing image again.
7. Open `/api/health` and confirm it reports `status: ok`, `mode: postgres` and `database: connected`.

Bootstrap is restart-safe and skips an already-created workspace, but removing the temporary password is still the correct close-out step.

## Choose the sales model

The Blueprint starts in **Service Sales** mode because it demonstrates the broader multi-offer workflow. After signing in, an administrator can switch the workspace model in Settings.

To start as a single-product or SaaS workspace instead, change `GUD_DEFAULT_MODEL` from `service` to `focused` before the first successful boot. Existing workspaces keep their saved model, so changing this variable later does not rewrite live data.

## Add a custom domain

The automatic URL setup uses the service's `onrender.com` address. If you later attach a custom domain:

1. complete Render's domain and DNS setup;
2. set both `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` to the same canonical `https://` origin;
3. save and deploy;
4. test sign-in, sign-out and password recovery again.

Do not keep one URL on the Render hostname and the other on the custom domain. GUD rejects mismatched authentication origins.

## Understand the free limits

- Render free web services currently spin down after 15 minutes without traffic. The next visit wakes the service and can take around a minute.
- Render's local filesystem is ephemeral. Do not switch this deployment to SQLite and do not treat local files as backups.
- Neon can suspend idle compute and free allowances may change. The database remains the source of truth, but important data still needs an export or database backup outside the project.
- The packaged service has no paid resource and no automatic provider upgrade. Check the current [Render free-service limits](https://render.com/docs/free) and [Neon plans](https://neon.com/pricing) before relying on it.
- Optional OpenAI, Resend, Hunter and Voila Norbert integrations are not part of the free hosting package. Add their keys later from Render's Environment page only if wanted.

For a public demo, use the resettable local demo commands rather than putting a real administrator account on a free public service. For dependable team use, use [Docker](DOCKER.md) or [CapRover](CAPROVER.md) with scheduled PostgreSQL backups.

## Updates

The Deploy button intentionally leaves automatic deployment off. To update:

1. read the release changes;
2. export or back up the Neon database;
3. open the Render service and choose **Manual Deploy -> Deploy latest commit**;
4. wait for `/api/health` to pass;
5. test sign-in and one read/write workflow.

GUD runs committed database migrations when the new container starts. A code rollback does not undo a migration, which is why the backup comes first.

## Other low-cost routes

| Route | Setup effort | Best use |
| --- | --- | --- |
| Render + Neon | Lowest | Free personal workspace and evaluation, with sleep/wake delays |
| CapRover on a small VPS | Moderate | A dependable small-team deployment with full control |
| Docker Compose on a server | Moderate | Teams comfortable managing Linux, HTTPS and backups |
| Oracle Always Free VM | Higher | Cost-conscious technical users willing to administer a server |
| Cloud Run or Azure Container Apps + managed Postgres | Higher | Teams already comfortable with a cloud console and usage billing |
| Cloudflare Workers | Port required | Not packaged yet; native modules and the runtime boundary must be adapted first |

There is no honest route that is simultaneously permanently free, production-reliable, commercially unrestricted, persistent and three clicks. GUD documents the trade-off rather than hiding it.

Official references: [Render Deploy button](https://render.com/docs/deploy-to-render), [Render Blueprint specification](https://render.com/docs/blueprint-spec), [Render free services](https://render.com/docs/free), [Render default environment variables](https://render.com/docs/environment-variables), and [Neon connection pooling](https://neon.com/docs/connect/connection-pooling).
