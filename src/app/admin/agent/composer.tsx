"use client";

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { IconChevronUp, IconCode, IconGear, IconGithub, IconOpenAI, IconPlus } from "@/components/icons";
import { MascotAvatar } from "@/components/mascot";
import { Sprite, type SpriteName } from "@/components/sprites";
import { startFromSourceAction, startTaskAction } from "../actions";
import { ActionForm, FormMessage, SubmitButton, useActionForm } from "../ui";

type Mode = "task" | "pr" | "diff";
type Template = { title: string; description: string; sprite: SpriteName; prompt?: string; href?: string };

function templates(unanswered: string[]): { group: string; items: Template[] }[] {
  return [
    {
      group: "Create an article",
      items: [
        {
          title: "Document a feature",
          description: "Research the code to understand how a feature works, then write clear documentation for customers.",
          sprite: "page",
          prompt:
            "Document how [feature] works: what it's for, how to set it up, and the common ways people use it. Check the code for exact labels and limits.",
        },
        {
          title: "Getting started guide",
          description: "An onboarding guide that takes new customers from sign-up to their first win.",
          sprite: "flag",
          prompt: "Write a getting started guide that takes a new customer from sign-up to [first goal].",
        },
        {
          title: "Integration guide",
          description: "Set up a third-party integration: prerequisites, connecting it, options, and fixes.",
          sprite: "plug",
          prompt:
            "Write a setup guide for the [service] integration: prerequisites, connecting it, configuration options, and fixing common problems.",
        },
        {
          title: "API reference",
          description: "Parameters, an example request and response, and the errors an endpoint returns.",
          sprite: "gear",
          prompt:
            "Document the [endpoint or resource] API: what it does, its parameters, an example request and response, and the errors it returns.",
        },
        {
          title: "Troubleshooting guide",
          description: "The problems customers hit most in one area, and how to fix each one.",
          sprite: "potion",
          prompt: "Write a troubleshooting guide for [area]: the problems customers hit most often and how to fix each one.",
        },
        {
          title: "Workaround",
          description: "The safest way to reach a goal the product doesn't support directly.",
          sprite: "bulb",
          prompt: "Customers want to [goal], which the product doesn't do directly. Write an article with the safest workaround.",
        },
      ],
    },
    {
      group: "Keep docs current",
      items: [
        {
          title: "Recent releases",
          description: "Read the pull requests merged in the last two weeks and update every affected article.",
          sprite: "rocket",
          prompt: "Look at the pull requests merged in the last 14 days and update every article they affect.",
        },
        {
          title: "Refresh an article",
          description: "Check one article against the current product and fix anything out of date.",
          sprite: "hourglass",
          prompt: 'Check the article "[title]" against the current product and fix anything that is out of date.',
        },
        {
          title: "Find and replace",
          description: "Change a name or phrase across every article, with a review before anything publishes.",
          sprite: "magnifier",
          href: "/admin/help-center/replace",
        },
        {
          title: "Standardize a section",
          description: "Give every article in a section the same structure without changing the facts.",
          sprite: "books",
          prompt:
            'Make every article in the "[section]" section follow one structure: a short overview, numbered steps, then notes. Keep the facts unchanged.',
        },
      ],
    },
    {
      group: "Learn from support",
      items: [
        {
          title: "Articles from conversations",
          description: "Write or update the articles that would have answered these tickets.",
          sprite: "bubble",
          prompt: "Write or update the articles that would have answered these support conversations:\n\n[paste conversations]",
        },
        {
          title: "FAQ from unanswered questions",
          description: "Answer the questions customers searched for and couldn't find.",
          sprite: "question",
          prompt: unanswered.length
            ? `Write an FAQ article answering these questions customers asked that the help center couldn't answer:\n${unanswered.map((q) => `- ${q}`).join("\n")}`
            : "Write an FAQ article answering these questions customers ask:\n- [question]",
        },
        {
          title: "Transcript to article",
          description: "Turn a recorded walkthrough into numbered steps.",
          sprite: "mic",
          prompt: "Turn this walkthrough transcript into a step-by-step article:\n\n[paste the transcript]",
        },
      ],
    },
    {
      group: "Internal docs",
      items: [
        {
          title: "Team playbook",
          description: "How the team handles a process, in a section only teammates can see.",
          sprite: "book",
          prompt: "Write an internal playbook for the team on [process]. Put it in a restricted section.",
        },
        {
          title: "Runbook",
          description: "Recognize a situation, resolve it step by step, and know when to escalate.",
          sprite: "key",
          prompt: "Write a runbook for handling [situation]: how to recognize it, steps to resolve it, and when to escalate.",
        },
      ],
    },
  ];
}

/** A connected tool's mark in the "Connected to" pill: a small white tile with a hairline ring. */
function ToolTile({ children, label }: { children: ReactNode; label: string }) {
  return (
    <span title={label} aria-label={label} className="-ml-1 flex size-5 items-center justify-center rounded bg-surface text-ink ring ring-line">
      {children}
    </span>
  );
}

export function Composer({
  disabled,
  initialPrompt,
  unanswered,
  github,
  openai,
}: {
  disabled: boolean;
  initialPrompt: string;
  unanswered: string[];
  github: string;
  openai: boolean;
}) {
  const [mode, setMode] = useState<Mode>("task");
  const taskForm = useActionForm(startTaskAction);
  const sourceForm = useActionForm(startFromSourceAction);
  const [prompt, setPrompt] = useState(initialPrompt);
  const area = useRef<HTMLTextAreaElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const busy = taskForm.pending || sourceForm.pending;
  const form = mode === "task" ? taskForm : sourceForm;

  function applyTemplate(t: Template) {
    if (!t.prompt) return;
    setPrompt(t.prompt);
    setMode("task");
    card.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    // Select the first [placeholder] so typing replaces it.
    requestAnimationFrame(() => {
      const el = area.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      const start = t.prompt!.indexOf("[");
      const end = t.prompt!.indexOf("]", start);
      if (start >= 0 && end > start) el.setSelectionRange(start, end + 1);
    });
  }

  const modeButton = (id: Mode, label: string, icon: ReactNode) => (
    <button
      type="button"
      onClick={() => setMode(mode === id ? "task" : id)}
      aria-pressed={mode === id}
      aria-label={label}
      title={label}
      className="btn btn-icon aria-pressed:bg-accent-soft aria-pressed:bg-none aria-pressed:text-accent-strong aria-pressed:shadow-none"
    >
      {icon}
    </button>
  );

  return (
    <div>
      <div ref={card} className="w-full overflow-hidden rounded-lg border border-line bg-sunken p-1">
        <div className="flex items-center gap-3 px-4 py-3">
          <MascotAvatar size={24} mood={busy ? "thinking" : "idle"} />
          <h3 className="min-w-0 truncate text-sm font-medium text-muted">What do you want me to do?</h3>
          <Link
            href="/admin/integrations"
            className="ml-auto hidden items-center rounded-md border border-dashed border-line-strong py-1 pr-1 pl-2 sm:flex"
          >
            <span className="relative mr-2">
              <span className={`block size-2 rounded-full ${github || openai ? "bg-ok/60" : "bg-line-strong"}`} />
              {(github || openai) && <span className="ping absolute inset-0 rounded-full bg-ok" />}
            </span>
            <span className="mr-3 text-xs font-medium text-muted">{github || openai ? "Connected to" : "Connect tools"}</span>
            {openai && (
              <ToolTile label="OpenAI">
                <IconOpenAI size={12} />
              </ToolTile>
            )}
            {github && (
              <ToolTile label={`GitHub: ${github}`}>
                <IconGithub size={12} />
              </ToolTile>
            )}
            <span className="-ml-1 flex size-5 items-center justify-center rounded bg-well text-faint ring ring-line">
              <IconPlus size={13} />
            </span>
          </Link>
          <Link
            href="/admin/settings/customize"
            aria-label="Customize Docs Agent"
            title="Customize Docs Agent"
            className="flex items-center rounded-md border border-dashed border-line-strong p-1 text-faint transition-colors hover:text-ink max-sm:ml-auto"
          >
            <IconGear size={16} />
          </Link>
        </div>

        <ActionForm form={form} className="relative rounded-md border border-line bg-surface">
          {mode === "task" ? (
            <>
              <label htmlFor="cm-prompt" className="sr-only">
                Task for Docs Agent
              </label>
              <textarea
                id="cm-prompt"
                ref={area}
                name="prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
                }}
                placeholder="Ask Docs Agent to write, rewrite, or check anything…"
                className="block max-h-[450px] min-h-[180px] w-full resize-none bg-transparent px-4 pt-5 pb-4 text-sm text-ink outline-none placeholder:text-faint"
              />
              {taskForm.state?.error && (
                <div className="px-4 pb-3">
                  <FormMessage state={taskForm.state} />
                </div>
              )}
            </>
          ) : (
            <div className="flex min-h-[180px] flex-col gap-4 p-4">
              <input type="hidden" name="mode" value={mode} />
              {mode === "pr" ? (
                <div>
                  <label className="label" htmlFor="cm-pr">
                    Pull request URL
                  </label>
                  <input id="cm-pr" name="prUrl" className="field" placeholder="https://github.com/owner/repo/pull/123" inputMode="url" autoFocus />
                  <p className="hint">Docs Agent reads the description and the diff, then checks the code around it.</p>
                </div>
              ) : (
                <>
                  <div>
                    <label className="label" htmlFor="cm-title">
                      What changed
                    </label>
                    <input id="cm-title" name="title" className="field" placeholder="Add CSV export to reports" autoFocus />
                  </div>
                  <div>
                    <label className="label" htmlFor="cm-desc">
                      Notes for Docs Agent <span className="font-normal text-muted">(optional)</span>
                    </label>
                    <textarea id="cm-desc" name="description" rows={2} className="field" />
                  </div>
                  <div>
                    <label className="label" htmlFor="cm-diff">
                      Diff
                    </label>
                    <textarea id="cm-diff" name="diff" rows={8} className="field font-mono text-xs" placeholder="Paste the output of git diff" />
                  </div>
                </>
              )}
              <FormMessage state={sourceForm.state} />
            </div>
          )}
          <div className="flex items-center justify-between border-t border-line p-4">
            <div className="flex items-center gap-2">
              {modeButton("pr", "Start from a pull request", <IconGithub size={14} />)}
              {modeButton("diff", "Start from a diff", <IconCode size={14} />)}
            </div>
            <SubmitButton
              className="btn btn-primary h-7 px-2.5 text-xs"
              disabled={disabled || (mode === "task" && !prompt.trim())}
              pendingLabel="Starting…"
            >
              <IconChevronUp size={14} />
              <span className="sr-only">{mode === "task" ? "Start task" : "Start"}</span>
            </SubmitButton>
          </div>
        </ActionForm>
      </div>

      {templates(unanswered).map((g, gi) => (
        <section key={g.group} className="mt-12" aria-labelledby={`tg-${gi}`}>
          <h2 id={`tg-${gi}`} className="kicker mb-3.5">
            {g.group}
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {g.items.map((t) => {
              const inner = (
                <>
                  <Sprite name={t.sprite} size={32} />
                  <span className="flex flex-col gap-1.5">
                    <span className="text-base font-medium text-ink">{t.title}</span>
                    <span className="line-clamp-3 text-sm leading-[1.45] text-muted">{t.description}</span>
                  </span>
                </>
              );
              const cls = "card card-hover flex h-full w-full flex-col gap-3 p-4 text-left";
              return (
                <li key={t.title}>
                  {t.href ? (
                    <Link href={t.href} className={cls}>
                      {inner}
                    </Link>
                  ) : (
                    <button type="button" onClick={() => applyTemplate(t)} className={cls}>
                      {inner}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
