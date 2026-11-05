"use client";

import { useEffect, useRef, useState } from "react";
import { IconExternal, IconLock, IconMonitor, IconPhone } from "@/components/icons";

const DESKTOP_WIDTH = 1440;

/**
 * The public help center in a browser frame on a dotted canvas. On desktop the page renders at
 * full width and is scaled down to fit the frame; on phone it renders at 390px. Reloads after
 * Customize saves.
 */
export function HelpCenterPreview({ host, path = "/help" }: { host: string; path?: string }) {
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const [version, setVersion] = useState(0);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const viewport = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reload = () => setVersion((v) => v + 1);
    window.addEventListener("hc-preview-reload", reload);
    return () => window.removeEventListener("hc-preview-reload", reload);
  }, []);

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [device]);

  const scale = device === "desktop" && box.w ? box.w / DESKTOP_WIDTH : 1;

  return (
    <div className="flex h-full flex-col">
      <div className="flex justify-end">
        <div className="segmented" role="group" aria-label="Preview size">
          <button type="button" onClick={() => setDevice("desktop")} aria-pressed={device === "desktop"} aria-label="Desktop preview" title="Desktop">
            <IconMonitor size={14} />
          </button>
          <button type="button" onClick={() => setDevice("phone")} aria-pressed={device === "phone"} aria-label="Phone preview" title="Phone">
            <IconPhone size={14} />
          </button>
        </div>
      </div>
      <div className="mt-6 flex min-h-0 flex-1 items-start justify-center">
        <div
          className={`pop-in flex flex-col overflow-hidden rounded-lg border border-line bg-sunken p-1 shadow-[var(--shadow-md)] ${
            device === "phone" ? "h-full max-h-[760px] w-[392px]" : "aspect-[920/537] max-h-full w-full max-w-[920px]"
          }`}
        >
          <div className="flex h-10 shrink-0 items-center gap-3 px-3">
            <span className="flex gap-1.5" aria-hidden>
              <span className="size-2 rounded-full bg-line-strong" />
              <span className="size-2 rounded-full bg-line-strong" />
              <span className="size-2 rounded-full bg-line-strong" />
            </span>
            <a
              href={path}
              target="_blank"
              title="Open the help center in a new tab"
              className="group mx-auto flex max-w-[70%] items-center gap-1.5 truncate rounded-md px-2.5 py-1 text-xs text-muted transition-colors hover:bg-well hover:text-ink"
            >
              <IconLock size={11} /> {host}
              {path === "/help" ? "" : path}
              <IconExternal size={11} className="opacity-0 transition-opacity group-hover:opacity-100" />
            </a>
            <span className="w-8" aria-hidden />
          </div>
          <div ref={viewport} className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-line bg-surface">
            <iframe
              key={version}
              title="Help center preview"
              src={path}
              className="absolute top-0 left-0 origin-top-left border-0 bg-white"
              style={
                device === "desktop" && box.w
                  ? { width: DESKTOP_WIDTH, height: box.h / scale, transform: `scale(${scale})` }
                  : { width: "100%", height: "100%" }
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
