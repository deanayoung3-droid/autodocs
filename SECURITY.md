# Security

## Reporting a vulnerability

Please report security problems privately, through GitHub's **Security → Report a vulnerability** on this repository, rather than in a public issue. Include what you found, how to reproduce it, and what it affects. You'll get a reply within a few days.

## Running it safely

- Use a long random `ADMIN_PASSWORD` and `SESSION_SECRET` (`npm run setup` generates both). `SESSION_SECRET` also seals the credentials stored in the database, so keep it with your backups and out of the repository.
- Serve it over HTTPS. The Docker setup's `--profile https` does this for you.
- Give your OpenAI key a monthly spending limit in your OpenAI account, and set `AI_DAILY_ASK_LIMIT` if your help center is public and busy.
- Give the screenshot test account access to sample data only, never real customers'.
- Optionally, give the admin its own address (`ADMIN_URL`) and put it behind your identity provider or a VPN.
