# Self-hosting with Docker

The simplest way to run AutoDocs for real: one server, Docker, and a domain. Postgres, the app, and (optionally) automatic HTTPS all come from `docker-compose.yml`.

## What you need

- **A server** with Docker and the Compose plugin. 2 GB of memory is enough for most help centers (the screenshot browser is the hungriest part); 1 CPU is fine. Any VPS works: Hetzner, DigitalOcean, Linode, AWS Lightsail, and so on. Install Docker with `curl -fsSL https://get.docker.com | sh`.
- **A domain** for the help center, like `docs.example.com`, with an `A` record pointing at the server's IP address. Ports 80 and 443 must be open.
- **An OpenAI API key** for the AI features (https://platform.openai.com/api-keys). Set a monthly limit in your OpenAI account.

## Install

On the server:

```bash
git clone https://github.com/DeanYoung1/autodocs.git
cd autodocs
```

Write the settings file. With Node installed, `npm run setup -- --docker` asks a few questions and writes `.env` with fresh secrets. Without Node:

```bash
cp .env.example .env
```

Then set at least these in `.env`:

```bash
ADMIN_PASSWORD=          # long and random: openssl rand -base64 24
SESSION_SECRET=          # openssl rand -hex 32, and never change it afterwards
PUBLIC_URL=https://docs.example.com
DOMAIN=docs.example.com  # for automatic HTTPS
OPENAI_API_KEY=sk-...
```

Start it, with HTTPS:

```bash
docker compose --profile https up -d --build
```

The first build takes a few minutes. Caddy gets a certificate from Let's Encrypt as soon as the domain points at the server. Open `https://docs.example.com/login`, leave the email empty, and sign in with `ADMIN_PASSWORD`. Then see [first-steps.md](first-steps.md).

Without a domain (to try it on a server first), leave out `--profile https` and open `http://SERVER-IP:3000`.

## Behind your own proxy

Already run nginx, Traefik, or a load balancer? Leave out `--profile https` and send traffic to port 3000 (change it with `PORT` in `.env`). Pass the usual `X-Forwarded-Proto` and `X-Forwarded-Host` headers, and allow request bodies of at least 5 MB (image uploads).

## Two addresses (optional)

To keep the admin off the public address, give it its own: point a second name (like `admin.docs.example.com`) at the server, and set both in `.env`:

```bash
PUBLIC_URL=https://docs.example.com
ADMIN_URL=https://admin.docs.example.com
DOMAIN=docs.example.com, admin.docs.example.com
```

Each address then serves only its half: admin pages on the public address redirect to the admin one, and the admin address is never indexed.

## Updating

```bash
git pull
docker compose --profile https up -d --build
```

Database changes run on start. They only add, so the previous version still runs on the newer database if you need to go back (`git checkout` the earlier version and rebuild).

## Backups

Everything lives in two Docker volumes: `db-data` (Postgres) and `files` (uploaded images and screenshots).

```bash
# The database, as one SQL file
docker compose exec -T db pg_dump -U autodocs autodocs | gzip > autodocs-$(date +%F).sql.gz
# Images and screenshots
docker run --rm -v autodocs_files:/data -v "$PWD":/backup alpine tar czf /backup/files-$(date +%F).tar.gz -C /data .
```

Run them daily (a cron job) and copy the files off the server. **Settings → Import & export → Download export** also makes a portable copy of the help center itself (articles in Markdown, plus images).

To restore the database into a fresh install: `gunzip -c autodocs-DATE.sql.gz | docker compose exec -T db psql -U autodocs autodocs`.

Keep `SESSION_SECRET` with your backups: credentials saved in the database (GitHub, Slack, helpdesks) are sealed with it.

## Without Docker

AutoDocs is a normal Next.js app. On any machine with Node 24:

```bash
npm ci
npx playwright install --with-deps chromium   # for screenshots
npm run build
npm start                                      # port 3000; set PORT to change it
```

Set the same environment variables. Without `DATABASE_URL` it uses the built-in database in `./data`, which is fine for one server; for anything bigger, point it at PostgreSQL 15+ with the `pgvector` extension (Supabase, Neon, RDS, and Cloud SQL all have it).

Platforms that build from a Dockerfile (Railway, Render, Fly.io) work too: use the `Dockerfile`, add a Postgres with pgvector, set `DATABASE_URL` and the variables above, and give it at least 2 GB of memory. Keep one instance always running: background work (the agent, syncs) runs inside the server.

## Troubleshooting

| You see | Do this |
|---|---|
| The site doesn't load over HTTPS | Check the domain's `A` record points at this server, and ports 80 and 443 are open. `docker compose logs caddy` says why a certificate wasn't issued. |
| "That password isn't right" at sign-in | Leave the email empty and use `ADMIN_PASSWORD` from `.env`. After changing `.env`, run `docker compose up -d` to restart. |
| AI features say to add a key | Set `OPENAI_API_KEY` in `.env` and restart. |
| Screenshots fail | The server needs at least 2 GB of memory. `docker compose logs app` shows the browser's error. |
| Anything else | `docker compose logs app --tail 200` |
