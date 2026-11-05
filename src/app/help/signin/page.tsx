import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { IconLock } from "@/components/icons";
import { currentReader } from "@/lib/auth";
import { mailerReady } from "@/lib/mailer";
import { getSettings } from "@/lib/settings";
import { EmailLinkForm } from "./email-link-form";
import { ReaderSignInForm } from "./signin-form";

export default async function ReaderSignInPage({ searchParams }: PageProps<"/help/signin">) {
  await connection();
  const sp = await searchParams;
  const next = typeof sp.next === "string" && sp.next.startsWith("/help") ? sp.next : "/help";
  if (await currentReader()) redirect(next);
  const s = await getSettings();
  const appSignIn = process.env.READER_SIGNIN_URL;
  const emailLink = s.readerEmailAllow.length > 0 && (await mailerReady());
  const or = <p className="my-4 text-center text-[12.5px] text-muted">or</p>;

  return (
    <div className="mx-auto max-w-sm py-10">
      <div className="card pop-in p-7">
        <span className="mb-4 flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <IconLock size={20} />
        </span>
        <h1 className="text-[20px] font-semibold tracking-tight">Sign in to read</h1>
        <p className="mt-1 mb-5 text-muted">
          {s.siteVisibility === "private" ? `The ${s.brandName} help center` : "This article"} is for signed-in readers.
        </p>
        {sp.expired && (
          <p role="alert" className="notice notice-error mb-4">
            That sign-in link expired or no longer works. Ask for a new one below.
          </p>
        )}
        {appSignIn && (
          <a href={`${appSignIn}${appSignIn.includes("?") ? "&" : "?"}return_to=${encodeURIComponent(next)}`} className="btn btn-primary mb-4 w-full">
            Continue with your {s.brandName} account
          </a>
        )}
        {emailLink && (
          <>
            {appSignIn && or}
            <EmailLinkForm next={next} />
          </>
        )}
        {s.readerPasswordHash ? (
          <>
            {(appSignIn || emailLink) && or}
            <ReaderSignInForm next={next} />
          </>
        ) : (
          !appSignIn && !emailLink && <p className="notice">Ask the team for access.</p>
        )}
      </div>
      <p className="mt-4 text-center text-[13px] text-muted">
        <Link href="/help" className="hover:text-ink">
          ← Back to the help center
        </Link>
      </p>
    </div>
  );
}
