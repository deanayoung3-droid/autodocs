// Class strings shared by server and client components (a "use client" module's exports can't be called on the server).

/** A row in a section's sidebar. Selected rows sit on the well colour; the rest are gray until hovered. */
export const subRow = (active: boolean) =>
  `group flex min-w-0 items-center gap-2 rounded px-3 py-1.5 text-left text-sm transition-colors duration-75 ${
    active ? "bg-well text-ink" : "text-muted hover:bg-well hover:text-ink"
  }`;
