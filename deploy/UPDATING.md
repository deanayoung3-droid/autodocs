# Running AutoDocs on Google Cloud

How changes reach your help center once the Google Cloud project is set up ([AGENT-SETUP.md](AGENT-SETUP.md)), and what to do day to day.

## Ship a change

Every push to `main` deploys. Working through pull requests is safest:

1. Push a branch and open a pull request into `main`.
2. Its checks run: lint and types, then the production image booted against a real Postgres (the same engine as Cloud SQL) with its pages checked.
3. Merge it.

Merging to `main` runs the same checks again, then:

1. Deploys the new version to Cloud Run with no traffic. It has to pass its startup health check.
2. Moves traffic to it, then checks your help center's address. If the site doesn't answer, traffic goes straight back to the previous version.

It takes about 10 minutes from merge. If any step fails, the site keeps running the previous version.

- **Watch it:** the repository's Actions tab, or `gh run watch`.
- **Undo:** Actions tab → the last good run → **Re-run all jobs**, which redeploys the older version. Or revert the change in a new pull request.

Database changes (migrations in `src/lib/schema.ts`) only go forward. A new version can add tables and columns, but rolling the code back doesn't remove them, so write migrations the old code can live with.

## Take new AutoDocs releases

If your repository is a fork, `gh repo sync` (or GitHub's **Sync fork** button) brings in the latest AutoDocs, and the push to `main` deploys it. Otherwise, add the AutoDocs repository as a remote and merge its `main`.

## Connect integrations at the final addresses

GitHub, Linear, Slack, and helpdesk webhooks are tied to the address they were connected from. Connect them after `domains.sh go-live`, so they don't need redoing when the address changes.

## Day to day

| You want to | Do this |
|---|---|
| Use a new OpenAI key | `deploy/gcp/put-secret.sh openai-api-key` in your own terminal. The app restarts with it. |
| See status, logs, latest errors | `deploy/gcp/status.sh`, or `gcloud run services logs read autodocs --region=REGION --limit=200` |
| Make the app or database bigger | `gcloud run services update autodocs --cpu=2 --memory=4Gi`, or Cloud SQL → `autodocs-db` → Edit |
| Restore the database | Cloud SQL → `autodocs-db` → Backups (daily, kept 14 days), or a point in time in the last 7 days with `gcloud sql instances clone --point-in-time` |
| Let someone read logs | `deploy/gcp/grant-viewer.sh THEIR_GOOGLE_EMAIL` |
| Download the help center | Admin → **Settings → Import & export → Download export** |

See [HOW-IT-WORKS.md](HOW-IT-WORKS.md) for what each Google Cloud piece holds.
