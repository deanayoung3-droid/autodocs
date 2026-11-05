# How the Google Cloud setup fits together

**Setting up a project:** hand [AGENT-SETUP.md](AGENT-SETUP.md) to an AI agent. Its scripts in `deploy/gcp/` create everything below and are safe to rerun.

**Shipping changes after that:** see [UPDATING.md](UPDATING.md). Every push to `main` deploys.

**Not on Google Cloud?** [docs/self-hosting.md](../docs/self-hosting.md) runs the same app on any server with Docker.

## How it fits together

| Piece | Holds |
|---|---|
| **GitHub** (your copy of the repository) | The code and `deploy/target.env` (which project to deploy to; no secrets). |
| **GitHub Actions** (`.github/workflows/deploy.yml`) | On every push and pull request: lint and types, the production image, and a boot test against Postgres with pgvector. On `main` it also deploys. |
| **Cloud Run** `autodocs` | The app: pages, API, and the background worker (Docs Agent, verification, screenshots, syncs). One instance is always on (`--min-instances 1 --no-cpu-throttling`) so background work never pauses. |
| **Cloud SQL** `autodocs-db` | PostgreSQL 17 with pgvector: articles, settings, sealed credentials, the job queue. Migrations run on startup under an advisory lock, so instances that start together take turns. |
| **Cloud Storage** | Screenshots and images, private, served through the app. |
| **Secret Manager** | `admin-password`, `session-secret`, `database-url`, `openai-api-key`. The app reads them at start. People change the OpenAI key with `deploy/gcp/put-secret.sh`, which keeps it off screen. |
| **Load balancer** | HTTPS for `PUBLIC_DOMAIN` (help center, widget, API, webhooks) and `ADMIN_DOMAIN` (admin), with a Google-managed certificate validated through DNS. Optionally, the admin sits behind Google's Identity-Aware Proxy (`deploy/gcp/iap.sh` with `IAP_USERS`): only the Google accounts it allows reach even the sign-in page. |

**How a deploy reaches Google Cloud.** It signs in with Workload Identity Federation. The project trusts only pushes to `main` of this one repository, matched by GitHub's permanent repository ID so renaming or moving it doesn't break deploys, through a deploy account that can publish new versions of this app and nothing else. No key is stored in GitHub.

**How a deploy goes live.** It starts the new version with no traffic, checks `/api/health` and `/help` on it, and only then moves traffic over. A version that fails to start never serves anyone. Cloud Run keeps earlier versions, so rolling back is a traffic switch.

**Two addresses, one app.** With `PUBLIC_URL` and `ADMIN_URL` set, `src/proxy.ts` keeps each address to its own half:

- On the public address, admin pages redirect to the admin address.
- On the admin address, readers' pages redirect to the public address and nothing gets indexed.
- Any other address (Cloud Run's own) serves everything, so the app can be tried before the domains point at it.

## Settings the app reads

| Variable | Set by | Notes |
|---|---|---|
| `ADMIN_PASSWORD` | setup.sh (generated) | Sign in at `/login` with this alone; add teammates in Settings → Team. |
| `SESSION_SECRET` | setup.sh (generated) | Signs sessions and seals saved credentials. Never change it: every integration would need reconnecting. |
| `DATABASE_URL` | setup.sh | `postgresql://autodocs:…@/autodocs?host=/cloudsql/PROJECT:REGION:autodocs-db` |
| `OPENAI_API_KEY` | put-secret.sh | Typed by a person into a hidden prompt. |
| `GCS_BUCKET` | setup.sh | |
| `PUBLIC_URL` | setup.sh, then `domains.sh go-live` | The Cloud Run address until go-live, then `https://PUBLIC_DOMAIN`. |
| `ADMIN_URL` | `domains.sh go-live` | `https://ADMIN_DOMAIN` |

Everything else (GitHub, Linear, Slack, helpdesks, email delivery, the screenshot test account) is connected in the admin and stored sealed in the database.

## Backups

- **Cloud SQL:** a daily backup kept for 14 days, plus point-in-time recovery for the last 7 days.
- **The bucket:** keeps deleted or replaced files for 30 days.
- **Content:** Settings → Import & export → Download export makes a portable copy of the help center (articles in Markdown, plus images).
