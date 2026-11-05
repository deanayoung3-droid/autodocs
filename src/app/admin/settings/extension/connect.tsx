"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { connectExtensionAction, disconnectExtensionAction } from "../../settings-actions";

type State = "checking" | "missing" | "ready" | "connecting" | "connected" | "failed";

function browserName(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : "Chrome";
  const os = /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

/**
 * Hands this browser's extension a sign-in. The extension's script on this page marks the page
 * when it's installed, takes the token from a window message, and answers once it has checked it.
 */
export function ConnectExtension({ autoConnect }: { autoConnect: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<State>("checking");
  const [version, setVersion] = useState("");
  const started = useRef(false);

  const connect = useCallback(async () => {
    setState("connecting");
    const { id, token } = await connectExtensionAction(browserName());
    const ok = await new Promise<boolean>((resolve) => {
      const done = (value: boolean) => {
        window.removeEventListener("message", onMessage);
        clearTimeout(timer);
        resolve(value);
      };
      const onMessage = (e: MessageEvent) => {
        if (e.source !== window || e.origin !== window.location.origin) return;
        if (e.data?.type === "autodocs:extension-connected") done(true);
        if (e.data?.type === "autodocs:extension-failed") done(false);
      };
      const timer = setTimeout(() => done(false), 6000);
      window.addEventListener("message", onMessage);
      window.postMessage({ type: "autodocs:extension-token", token }, window.location.origin);
    });
    // A sign-in the extension never took would only sit there unused.
    if (!ok) await disconnectExtensionAction(id);
    setState(ok ? "connected" : "failed");
    router.refresh();
  }, [router]);

  useEffect(() => {
    // The extension's script runs after the page loads, so keep looking until it shows up.
    const look = () => {
      const found = document.documentElement.dataset.autodocsExtension ?? "";
      setVersion(found);
      setState((s) => (found ? (s === "checking" || s === "missing" ? "ready" : s) : s === "checking" ? "missing" : s));
      return Boolean(found);
    };
    let timer: ReturnType<typeof setTimeout>;
    const poll = (delay: number) => (timer = setTimeout(() => look() || poll(1000), delay));
    poll(400);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (autoConnect && state === "ready" && !started.current) {
      started.current = true;
      void connect();
    }
  }, [autoConnect, state, connect]);

  if (state === "checking") return <p className="text-[13px] text-muted">Looking for the extension in this browser…</p>;
  if (state === "missing")
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted">The extension isn&rsquo;t installed in this browser yet. Install it above, then reload this page.</p>
        <button type="button" className="btn btn-sm" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  if (state === "connected")
    return (
      <p role="status" className="notice">
        Connected. Open the extension with Alt+F, or type !! in any reply box.
      </p>
    );
  return (
    <div className="flex flex-col gap-3">
      {state === "failed" && (
        <p role="alert" className="notice notice-error">
          The extension didn&rsquo;t answer. Reload this page and try again; if it keeps happening, remove the extension and install a fresh download.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted">Extension {version} is installed.</p>
        <button type="button" className="btn btn-primary btn-sm" disabled={state === "connecting"} onClick={() => void connect()}>
          {state === "connecting" ? "Connecting…" : state === "failed" ? "Try again" : "Connect"}
        </button>
      </div>
    </div>
  );
}
