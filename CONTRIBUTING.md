# Contributing to AutoDocs

Thanks for helping. Bug reports, fixes, and docs improvements are all welcome.

## Get it running

```bash
npm install
npm run setup     # writes .env.local with fresh secrets
npm run dev       # http://localhost:3000
```

The built-in database lives in `./data`; delete that folder for a clean start. The AI features need an `OPENAI_API_KEY`; everything else works without one.

## Before you open a pull request

```bash
npm run lint
npm run typecheck
npm run build
```

GitHub Actions runs the same checks, then builds the Docker image and boots it against Postgres to check the main pages answer.

## How the code is laid out

| Where | What |
|---|---|
| `src/app/help` | The public help center |
| `src/app/admin` | The admin |
| `src/app/widget`, `src/app/widget.js` | The embeddable widget and its loader script |
| `src/app/api` | Webhooks (GitHub, Slack, Linear), the public API (`/api/v1`), MCP, and the widget's endpoints |
| `src/lib/agent.ts` | The docs agent: tasks, drafting, and its tools |
| `src/lib/pr-intake.ts` | Sorting merged pull requests and starting drafts |
| `src/lib/verification.ts` | Checking articles against the code |
| `src/lib/capture.ts` | Screenshots with Playwright |
| `src/lib/search.ts` | Keyword and meaning search (Postgres full-text and pgvector) |
| `src/lib/jobs.ts`, `src/lib/scheduler.ts` | The background job queue and scheduled work |
| `src/lib/schema.ts` | Database migrations |

## Conventions

- **Migrations only go forward.** Add a new numbered entry at the end of `src/lib/schema.ts`; never edit one that has shipped. Write them so the previous version of the code still runs on the new schema.
- **Secrets never leave the server.** Credentials people connect in the admin are sealed with `SESSION_SECRET` before they're stored (`src/lib/crypto.ts`).
- **Words matter.** Interface copy is plain, in sentence case, and names things by what people do ("Connect GitHub"), not how they're built.
- This is Next.js 16: some APIs differ from older versions. `AGENTS.md` points AI coding tools at the right docs.

## Reporting security issues

Please don't open a public issue. See [SECURITY.md](SECURITY.md).
