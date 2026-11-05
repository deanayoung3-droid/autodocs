# First steps after installing

You've signed in with the setup password and created the owner account. Here's the order that gets a useful help center fastest. Only the first two are needed to go live; the rest make the docs agent useful.

## 1. Make it yours (5 minutes)

**Help Center → Customize.** Upload your logo, pick your accent colour, add header links (for example "Sign in" to your product), footer links (Terms, Privacy), and the support address readers can contact. The name you entered at setup is already on every page; change it in **Settings → General**.

## 2. Add your articles

Pick one:

- **Bring an existing help center over:** **Settings → Import & export**, paste its address. Help centers that publish `llms.txt` import exactly (sections in order, Markdown, images copied here); others import from their sitemap. Old addresses redirect to the new pages, so links and search rankings carry over.
- **Write them:** **Help Center → New article.** The editor works like a document; Markdown is what's stored.
- **Ask the agent:** **Docs Agent → Create task**, for example "Write a getting-started article for new admins". Its drafts wait for your review.

## 3. Turn on the AI features

If you skipped the OpenAI key during setup, add `OPENAI_API_KEY` to your settings file (`.env.local`, or `.env` for Docker) and restart. **Settings → AI models** shows which models run each feature and what they cost; **Settings → Usage** shows spending. Set a monthly limit in your OpenAI account too.

## 4. Connect your code

**Integrations → GitHub → Create the GitHub App.** One click creates a private GitHub App for this install; install it on the repositories that hold your product. From then on, every merged pull request is sorted (does a customer notice it?) and, when it matters, the agent drafts the article changes. Tune it in **Settings → Automations**.

Tell the agent about your product in **Settings → About you** and **Settings → Customize** (house rules, words to use, what to leave out). It follows these in every draft.

## 5. Screenshots (optional)

**Integrations → Dashboard.** Add your product's address and a dedicated test account (a test workspace with sample data, never a real customer's). A normal email-and-password form signs in on its own; for anything else, write the steps using `{{email}}` and `{{password}}`. If your product signs in with emailed codes, connect the login email on the same page.

The agent then captures screenshots while writing, with a red box around the control a step describes, and checks the box is on the right element before using it. Retake any screenshot after a UI change: every article using it updates.

## 6. Put help in your product

**Widget → Install.** Paste the one script tag into your product. It adds a help button with search, AI answers, and a contact form, styled in **Widget → Customize**. Your page can also open it: `AutoDocs("open")`, `AutoDocs("ask", "How do I…?")`.

## 7. Bring the team in

- **Settings → Email delivery:** connect an SMTP server (or a provider like Postmark, Resend, or SES) so invitations, password resets, and notifications send.
- **Settings → Team:** invite teammates as admins (publish, manage the team, change settings) or contributors (write drafts and work with the agent; they can't publish).
- **Integrations → Slack:** a `/docs` command and channel notifications for drafts, published articles, and readers asking for a person.
- **Integrations → Support tooling:** connect your helpdesk so the agent learns from resolved conversations what customers keep asking.

## Where things are

| You want to | Go to |
|---|---|
| Review the agent's drafts | **Home** or **Docs Agent** (each draft is a diff you can edit) |
| Check articles against the code | **Verification** |
| See what readers search for and can't find | **Reporting** |
| Use the docs from Claude, ChatGPT, or Cursor | **MCP** |
| Download everything | **Settings → Import & export → Download export** |
