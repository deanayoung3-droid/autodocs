# Set up AutoDocs on Google Cloud

**For an AI agent** (Claude Code, Codex, Cursor, or any agent that can run terminal commands) helping someone host AutoDocs on their Google Cloud account. Read this whole file before starting, then work through it in order.

AutoDocs is a help center (for example docs.example.com), its admin (admin.docs.example.com), and Docs Agent, the AI agent that keeps the docs current. When you're done, every push to the `main` branch of your human's copy of the repository builds, tests, and deploys itself to their Google Cloud project.

Expect about an hour, mostly waiting on Google. Your human will do a few things by hand: sign in twice in a browser, paste the OpenAI key into a hidden prompt, create the owner account, and add DNS records for their domain. Everything else happens on its own.

## Ground rules

- **Never see a secret.** Secrets go into Google Secret Manager through `deploy/gcp/put-secret.sh`, which your human runs in their own terminal window. Never run that script yourself, never pipe a value into it, and never ask for a key in chat. If your human pastes a key into chat anyway, don't use it. Tell them to rotate it at platform.openai.com, then use the script.
- **Every script is safe to run again.** If a step fails, read the error, fix the cause (usually a permission, an API that's still turning on, or billing), and rerun the same script. Exit code `75` isn't an error: it means "come back in a few minutes", and the message says why.
- **Never delete to start over.** After the first deploy, the database holds the real help center. Ask your human before deleting anything in the project.
- **Ask before spending money or changing DNS.** The running cost is in "What this costs" below. Get your human's OK before you link billing.
- **Don't change the app's code.** If the build or the app itself fails, collect the error (`gh run view --log-failed`) and show it to your human rather than editing source files. Files under `deploy/` are fair game if a command needs fixing for this account.

## How to work

- **Do every step yourself**, in order, from step 1 through step 9, without waiting to be asked. Stop only where a step says **your human**, and then tell them exactly what to do, in the words given.
- **Keep a checklist** of the steps, and tell your human where things stand after each one.
- **Long waits:** the database takes 5 to 15 minutes to create, the first build about 15, and the certificate up to an hour. Don't sit in a single command for that long. Rerun the script after a few minutes, or watch it in the background if your tools allow (for example `gh run watch` in the background).
- **Picking this up partway?** Your human may have closed the session. Run `deploy/gcp/status.sh` and read `deploy/target.env` to see what's done, then continue from the first step that isn't. Every script is safe to run again.
- **Stop after step 9.**

## What this costs

About **$125 a month**, billed to the project's billing account (list prices, us-central1):

| Piece | What it is | Roughly |
|---|---|---|
| Cloud Run | The app: 1 CPU, 2 GB memory, always on (Docs Agent works in the background) | $52 |
| Cloud SQL | PostgreSQL 17, 1 CPU / 3.75 GB, daily backups, point-in-time recovery | $52 |
| Load balancer | HTTPS for the help center and admin domains | $18 |
| Storage, logs, images | Screenshots bucket, container images, logs | under $5 |

OpenAI usage is separate and billed to your human's OpenAI account; suggest they set a monthly limit in OpenAI's billing settings. `deploy/gcp/alerts.sh` sets a budget alert (default $200 a month). The budget only warns; nothing gets switched off.

## 1. Ask your human

Ask these before running anything:

1. **Google Cloud project.** A new project just for this is best, for example `autodocs-prod`. Which billing account should pay for it?
2. **Alert emails.** Who should get an email if the site goes down or spending runs high?
3. **Domains.** Which address should the help center have (for example `docs.example.com`), and the admin (for example `admin.docs.example.com`)? Where is the domain's DNS managed, and can your human add records there? If the help center address already serves an old help center, it keeps doing so until your human is ready to switch (step 7).
4. **Moving from an existing help center?** If so, its address. AutoDocs can fill itself from it on first start (articles, sections, images, and redirects from the old addresses).
5. **Their OpenAI API key.** Your human uses their own, from platform.openai.com → API keys. A key in a new OpenAI project just for this is best, so its usage and limit stay separate. The account needs billing set up (new accounts need prepaid credit) and access to the models AutoDocs uses: GPT-6.1 Sol, GPT-6.1 Terra, GPT-6 Luna, and text-embedding-3-small. Your human pastes it in step 5. You never see it.

## 2. Tools and sign-in

Check what's installed: `gcloud --version`, `gh --version`, `git --version`. On a Mac, install anything missing with Homebrew. If Homebrew itself is missing, ask your human to install it from https://brew.sh (it asks for their Mac password). On Windows or Linux, use Google's and GitHub's own installers instead.

```bash
brew install --cask google-cloud-sdk
```

```bash
brew install gh
```

Then have your human sign in. Each command opens a browser:

```bash
gcloud auth login
```

```bash
gh auth login
```

## 3. Get the code

Deploys run from your human's own copy of the repository on GitHub, so make one (a fork, or a new private repository with the same code) and clone it:

```bash
gh repo fork OWNER/autodocs --clone && cd autodocs
```

Use the address of the AutoDocs repository your human started from in place of `OWNER/autodocs`. If they'd rather keep it private, create a private repository with `gh repo create autodocs --private`, push this code to it, and clone that instead.

Run every command below from this folder.

## 4. Create the project and describe it

If your human wants a new project and agreed to the cost:

```bash
gcloud projects create autodocs-prod --name="AutoDocs"
```

```bash
gcloud billing accounts list
```

```bash
gcloud billing projects link autodocs-prod --billing-account=ACCOUNT_ID
```

Project IDs are global, so if `autodocs-prod` is taken, add a suffix. Then:

```bash
cp deploy/target.env.example deploy/target.env
```

Edit `deploy/target.env`: set `GCP_PROJECT`, `ALERT_EMAILS` (comma-separated), `PUBLIC_DOMAIN`, and `ADMIN_DOMAIN`. Leave the sizes as they are unless your human says otherwise. If your human is moving from an existing help center, also run `export SEED_IMPORT_URL=https://THEIR-OLD-HELP-CENTER` before step 5.

## 5. Run the setup

```bash
deploy/gcp/setup.sh
```

It turns on the Google Cloud services, then creates the database server, image storage, the screenshots bucket, two service accounts, generated secrets, the GitHub trust, and the app. It prints each step. Expect two pauses, both exit code `75`:

- **"The database server is still being created."** Wait about 5 minutes and run it again. It continues where it stopped.
- **"Waiting for the OpenAI key."** Tell your human, word for word:

  > Open a new Terminal window, go to the autodocs folder, and run `deploy/gcp/put-secret.sh openai-api-key`. Paste your OpenAI API key (it stays hidden), press Enter, and tell me when it says Saved.

  Then run `deploy/gcp/setup.sh` again.

It's done when it prints "Setup is complete". It has written your project's details (not secrets) into `deploy/target.env`.

## 6. First deploy

```bash
git add deploy/target.env && git commit -m "Deploy to Google Cloud" && git push
```

That push starts GitHub Actions. It lint-checks the code, builds the image, starts it against a real Postgres to prove it works, then deploys it. The new version only gets traffic once its health check passes. Watch it:

```bash
gh run watch
```

The first run takes about 15 minutes. When it's green, check `curl -s "$(grep ^SERVICE_URL= deploy/target.env | cut -d= -f2)/api/health"`. It should print `{"ok":true}`, and the same address with `/help` on the end shows the help center. If you set `SEED_IMPORT_URL`, the app copies the old help center over on its first start (every article, section, and image, plus redirects so old links keep working); give it a few minutes.

If the run fails:

- **In "Sign in to Google Cloud":** permissions on a new project can take a minute to apply. Re-run it with `gh run rerun --failed`.
- **Anywhere else:** run `gh run view --log-failed`. If the error is in Google Cloud setup, fix it under `deploy/`. If it's in the app, show the error to your human.

## 7. Alerts and domains

```bash
deploy/gcp/alerts.sh
```

```bash
deploy/gcp/domains.sh
```

`domains.sh` sets up the load balancer and requests the HTTPS certificate, then prints DNS records. Have your human add the records marked **Now** where the domain's DNS is managed (on Cloudflare, set each to **DNS only**, the grey cloud):

- two `CNAME` records starting with `_acme-challenge.`, which let Google issue the certificate;
- one `A` record for the admin domain.

The last record, an `A` record for the help center's own domain, puts it in front of readers. If that domain is new, add it now too. If it still serves an old help center, wait until your human is ready to switch; nothing changes for readers until then.

Check progress (the certificate usually takes 10 to 20 minutes after the records appear, at most an hour):

```bash
deploy/gcp/domains.sh status
```

## 8. Go live and create the owner account

When `domains.sh status` shows the certificate is **ACTIVE** and the help center's `A` record points at the load balancer (step 7):

```bash
deploy/gcp/domains.sh go-live
```

```bash
deploy/gcp/alerts.sh
```

```bash
git add deploy/target.env && git commit -m "Live on our domains" && git push
```

`domains.sh status` should then show both addresses answering. Links from an old help center (if you imported one) redirect to the new pages. To undo, point the help center's DNS record back where it was.

Then tell your human, word for word:

> Open a new Terminal window, go to the autodocs folder, and run `deploy/gcp/owner-link.sh`. It opens a page where you name your help center and create the owner account with your name, email, and a password.

That link works once: as soon as an owner account exists, it stops working. Everyone else joins by invitation from **Settings → Team** in the admin. They get an email (or a link, until email delivery is set up) and choose their own password, and they can reset it themselves with "Forgot password?".

The setup password (the `admin-password` secret) also signs in as an owner, as a way back in if every owner is locked out. Your human can read it in their own terminal with `gcloud secrets versions access latest --secret=admin-password --project=PROJECT_ID`. Don't run that yourself.

If someone else should be able to read the logs without owning the project, give them read-only access:

```bash
deploy/gcp/grant-viewer.sh THEIR_GOOGLE_EMAIL
```

## 9. Report back

Run `deploy/gcp/status.sh` and `deploy/gcp/domains.sh status`. Then tell your human, with no secrets:

- **Help center:** `https://PUBLIC_DOMAIN` (or the `SERVICE_URL` plus `/help`, if the domain isn't pointed here yet).
- **Admin:** `https://ADMIN_DOMAIN/admin` once its certificate is ACTIVE, otherwise the `SERVICE_URL` plus `/admin`.
- **Google Cloud project:** its ID, the region, and who gets alert emails.
- **DNS:** which records are in, and the load balancer IP (`LB_IP` in `deploy/target.env`).
- **Anything that didn't work,** with the error.
- **Next:** [docs/first-steps.md](../docs/first-steps.md) walks through branding, articles, GitHub, and screenshots in the admin.

Then tell your human the setup is done. Updates deploy themselves on every push to `main`.

## Later

- **Updates** deploy on every push to `main`. To take new AutoDocs releases, merge them into your human's copy (for a fork: `gh repo sync`).
- **A new OpenAI key:** your human runs `deploy/gcp/put-secret.sh openai-api-key` again. The app restarts with it.
- **Status, logs, latest errors:** `deploy/gcp/status.sh`.
- **Roll back a bad update:** re-run an earlier green run on GitHub (Actions tab → the run → Re-run all jobs). Or switch traffic to the previous version directly:

  ```bash
  gcloud run revisions list --service=autodocs --region=us-central1
  ```

  ```bash
  gcloud run services update-traffic autodocs --region=us-central1 --to-revisions=REVISION=100
  ```

- **Restore the database** to a point in time (it's kept for 7 days): Cloud SQL → autodocs-db → Backups, or `gcloud sql instances clone` with `--point-in-time`. Ask your human first.

## Troubleshooting

| You see | Do this |
|---|---|
| `PERMISSION_DENIED` creating things | Your human needs Owner on the project (`gcloud projects get-iam-policy PROJECT_ID`). |
| `Billing account … not found` / `billing is disabled` | Link billing (step 4), then rerun. |
| An API "has not been used in project" | It was just turned on. Wait a minute and rerun. |
| The app at its address says "Hello" | That's the placeholder from setup. The real app replaces it when the first GitHub run finishes (step 6). |
| A constraint about `allUsers` or domain-restricted sharing | The project's organization blocks public access. Setup uses `--no-invoker-iam-check` to avoid this; if it still appears, an org admin has to allow it for this project. |
| The certificate stays `PROVISIONING` for over an hour | Run `domains.sh status`. Usually a CNAME is missing, or Cloudflare's proxy (orange cloud) is on. |
| GitHub run fails in "Start it against Postgres" | The app didn't start. Show your human the output of `gh run view --log-failed`. |
| The help center is still empty 15 minutes after the first deploy (with `SEED_IMPORT_URL` set) | Look for `[seed]` and `[jobs] import` in `gcloud run services logs read autodocs --region=us-central1 --limit=200`. The import can also be started by hand: admin → Settings → Import & export. |
| `owner-link.sh` says the link stops working, or the page says the workspace already has an owner | An owner account exists already. Sign in at `/login`, or use "Forgot password?". |

## What the scripts create

All of it lives in one project, named so it's easy to find:

- **Cloud Run** `autodocs`, running as `autodocs-run@…`
- **Cloud SQL** `autodocs-db` with database `autodocs`
- **Bucket** `PROJECT-autodocs-files`
- **Artifact Registry** `autodocs` (keeps the newest 15 images)
- **Secrets:** `admin-password`, `session-secret`, `database-url`, `openai-api-key`
- **GitHub trust:**
  - the pool `github` with provider `autodocs`;
  - the deploy account `autodocs-deploy@…`, which may only publish new versions of this one app.
- **Load balancer:**
  - the address `autodocs-ip`;
  - the certificate `autodocs-cert`;
  - the rest named `autodocs-*`.
- **Uptime checks, alert policies, and a budget,** all named "AutoDocs …".

`session-secret` seals saved integration credentials in the database. Never change or delete it, or every integration has to be connected again.
