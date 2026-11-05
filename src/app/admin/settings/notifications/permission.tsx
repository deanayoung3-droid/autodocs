"use client";

import { useEffect, useState } from "react";

/** Browser notifications need this browser's permission as well as the setting. */
export function BrowserPermission() {
  const [state, setState] = useState<NotificationPermission | "unsupported" | null>(null);
  useEffect(() => {
    // Read after mount: the server can't know this browser's permission.
    const read = () => setState(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    read();
  }, []);
  if (state === null) return null;
  if (state === "unsupported") return <p className="text-[12.5px] text-muted">This browser doesn&rsquo;t support notifications.</p>;
  if (state === "granted") return <p className="text-[12.5px] text-success">Allowed in this browser.</p>;
  if (state === "denied") return <p className="text-[12.5px] text-warn-strong">Blocked in this browser. Allow notifications for this site in the browser&rsquo;s settings.</p>;
  return (
    <button type="button" className="btn btn-sm w-fit" onClick={() => Notification.requestPermission().then(setState)}>
      Allow in this browser
    </button>
  );
}
