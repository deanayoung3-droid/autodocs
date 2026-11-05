// Small line icons drawn for AutoDocs. 24×24 grid, stroke uses currentColor.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconHome = (p: P) => (
  <Svg {...p}>
    <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />
  </Svg>
);
export const IconInbox = (p: P) => (
  <Svg {...p}>
    <path d="M4 13.5 6.2 5.6A1 1 0 0 1 7.2 5h9.6a1 1 0 0 1 1 .6l2.2 7.9V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
    <path d="M4 13.5h4.5l1.5 2.5h4l1.5-2.5H20" />
  </Svg>
);
export const IconSpark = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.5c.5 4.2 2.3 6 6.5 6.5-4.2.5-6 2.3-6.5 6.5-.5-4.2-2.3-6-6.5-6.5 4.2-.5 6-2.3 6.5-6.5Z" />
    <path d="M18.5 15.5c.2 1.5.8 2.1 2.3 2.3-1.5.2-2.1.8-2.3 2.3-.2-1.5-.8-2.1-2.3-2.3 1.5-.2 2.1-.8 2.3-2.3Z" />
  </Svg>
);
export const IconShield = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.5 5 6v5.5c0 4.3 2.9 7.6 7 9 4.1-1.4 7-4.7 7-9V6z" />
    <path d="m9 12 2.2 2.2L15.5 10" />
  </Svg>
);
export const IconDoc = (p: P) => (
  <Svg {...p}>
    <path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20z" transform="translate(-1 0)" />
    <path d="M13 3.5V8h4.5M9 12h6M9 15.5h6" />
  </Svg>
);
export const IconChart = (p: P) => (
  <Svg {...p}>
    <path d="M4 20h16" />
    <path d="M7 16v-4M12 16V7M17 16v-6.5" />
  </Svg>
);
export const IconWidget = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="12" rx="2" />
    <circle cx="17.5" cy="18.5" r="2.5" />
    <path d="M7 8.5h6M7 11.5h4" />
  </Svg>
);
export const IconGear = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="2.8" />
    <path d="M10.4 3.6h3.2l.5 2.4 1.6.9 2.3-.8 1.6 2.8-1.8 1.6v1.9l1.8 1.6-1.6 2.8-2.3-.8-1.6.9-.5 2.4h-3.2l-.5-2.4-1.6-.9-2.3.8-1.6-2.8 1.8-1.6v-1.9L4.4 8.9 6 6.1l2.3.8 1.6-.9z" />
  </Svg>
);
export const IconExternal = (p: P) => (
  <Svg {...p}>
    <path d="M14 4h6v6M20 4l-8.5 8.5M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </Svg>
);
export const IconLogout = (p: P) => (
  <Svg {...p}>
    <path d="M14 8V5.5a1 1 0 0 0-1-1H5.5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1H13a1 1 0 0 0 1-1V16M10 12h10M17 9l3 3-3 3" />
  </Svg>
);
export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Svg>
);
export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IconArrow = (p: P) => (
  <Svg {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);
export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);
export const IconTrash = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12.5h9.4L17.5 7" />
    <path d="M10 10.5v6M14 10.5v6" />
  </Svg>
);
export const IconX = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const IconLock = (p: P) => (
  <Svg {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="2" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </Svg>
);
export const IconBell = (p: P) => (
  <Svg {...p}>
    <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" />
    <path d="M10 20.5a2 2 0 0 0 4 0" />
  </Svg>
);
export const IconGlobe = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5s1.1-6.1 3.4-8.5Z" />
  </Svg>
);
export const IconCopy = (p: P) => (
  <Svg {...p}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
  </Svg>
);
export const IconBook = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 5.5c2.8-.9 5.3-.6 7.5 1 2.2-1.6 4.7-1.9 7.5-1V18c-2.8-.9-5.3-.6-7.5 1-2.2-1.6-4.7-1.9-7.5-1z" />
    <path d="M12 6.5V19" />
  </Svg>
);
export const IconBolt = (p: P) => (
  <Svg {...p}>
    <path d="M13 3.5 5.5 13.5H12l-1 7 7.5-10H12z" />
  </Svg>
);
export const IconUsers = (p: P) => (
  <Svg {...p}>
    <circle cx="9" cy="9" r="3.2" />
    <path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8M15.5 6.2a3 3 0 0 1 0 5.6M17.5 14.6c1.6.6 2.7 2.1 3 4.4" />
  </Svg>
);
export const IconKey = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="15" r="3.5" />
    <path d="m10.5 12.5 8-8M15.5 7.5l2 2M17.5 5.5l2 2" />
  </Svg>
);
export const IconChat = (p: P) => (
  <Svg {...p}>
    <path d="M5 5.5h14a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1h-7.5L7 19.5V16H5a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z" />
  </Svg>
);

/**
 * The product's mark when a workspace hasn't uploaded a logo: a page with a folded corner and two
 * lines of text, in a rounded tile. Drawn in the current text colour, so it follows the theme.
 */
const MARK =
  "M6 0h12a6 6 0 0 1 6 6v12a6 6 0 0 1-6 6H6a6 6 0 0 1-6-6V6a6 6 0 0 1 6-6Zm2 5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-8.6L12.6 5H8Zm4.2 1.4L15.6 9.8h-2.4a1 1 0 0 1-1-1V6.4ZM9.5 12.5a.75.75 0 0 0 0 1.5h5a.75.75 0 0 0 0-1.5h-5Zm0 2.75a.75.75 0 0 0 0 1.5h3.5a.75.75 0 0 0 0-1.5H9.5Z";

/** The mark on its own, for small spaces. */
export function BrandMark({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" className={`shrink-0 ${className}`} aria-hidden>
      <path d={MARK} />
    </svg>
  );
}

/** The mark beside the workspace's name, for headers that have no uploaded logo. */
export function BrandLogo({ height = 20, label }: { height?: number; label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center font-semibold tracking-[-0.01em] whitespace-nowrap" style={{ gap: height * 0.4, fontSize: height * 0.8, lineHeight: 1 }}>
      <BrandMark size={height} />
      {label}
    </span>
  );
}

export const IconPlug = (p: P) => (
  <Svg {...p}>
    <path d="M9 3.5V8M15 3.5V8M6.5 8h11v3a5.5 5.5 0 0 1-11 0z" />
    <path d="M12 16.5v4" />
  </Svg>
);
export const IconMcp = (p: P) => (
  <Svg {...p}>
    <path d="m12 3.5 8.5 8.5-8.5 8.5L3.5 12z" />
    <path d="m8.5 12 3.5-3.5 3.5 3.5-3.5 3.5z" />
  </Svg>
);
export const IconHelp = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.6" />
    <path d="M12 17h.01" />
  </Svg>
);
export const IconChevronDown = (p: P) => (
  <Svg {...p}>
    <path d="m7 10 5 5 5-5" />
  </Svg>
);
export const IconChevronUp = (p: P) => (
  <Svg {...p}>
    <path d="m7 14 5-5 5 5" />
  </Svg>
);
export const IconPaw = (p: P) => (
  <Svg {...p}>
    <path d="M12 12.5c-2.6 0-5 2.4-5 4.6 0 1.6 1.3 2.4 2.7 2.4.9 0 1.5-.4 2.3-.4s1.4.4 2.3.4c1.4 0 2.7-.8 2.7-2.4 0-2.2-2.4-4.6-5-4.6Z" />
    <ellipse cx="8.8" cy="6.8" rx="1.6" ry="2.1" />
    <ellipse cx="15.2" cy="6.8" rx="1.6" ry="2.1" />
    <ellipse cx="5.2" cy="11" rx="1.5" ry="1.9" />
    <ellipse cx="18.8" cy="11" rx="1.5" ry="1.9" />
  </Svg>
);
export const IconThumbUp = (p: P) => (
  <Svg {...p}>
    <path d="M7.5 10.5v9H5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zM7.5 10.5 11 4a2 2 0 0 1 2.4 2.3l-.6 3.2h5.4a2 2 0 0 1 2 2.3l-1 6.2a2 2 0 0 1-2 1.7H7.5" />
  </Svg>
);
export const IconThumbDown = (p: P) => (
  <Svg {...p}>
    <path d="M16.5 13.5v-9H19a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1zM16.5 13.5 13 20a2 2 0 0 1-2.4-2.3l.6-3.2H5.8a2 2 0 0 1-2-2.3l1-6.2a2 2 0 0 1 2-1.7h9.7" />
  </Svg>
);
export const IconImage = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="5" width="16" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.5" />
    <path d="m20 16-4.5-4.5L7 19" />
  </Svg>
);
export const IconChevronRight = (p: P) => (
  <Svg {...p}>
    <path d="m10 7 5 5-5 5" />
  </Svg>
);
export const IconChevronLeft = (p: P) => (
  <Svg {...p}>
    <path d="m14 7-5 5 5 5" />
  </Svg>
);
export const IconChevronUpDown = (p: P) => (
  <Svg {...p}>
    <path d="m8 9.5 4-4 4 4M8 14.5l4 4 4-4" />
  </Svg>
);
export const IconFolder = (p: P) => (
  <Svg {...p}>
    <path d="M4 7a1 1 0 0 1 1-1h4.2l2 2H19a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
  </Svg>
);
export const IconFile = (p: P) => (
  <Svg {...p}>
    <path d="M7 3.5h6.5L18 8v12a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20z" />
    <path d="M13.5 3.5V8H18M9.5 12.5h5M9.5 16h5" />
  </Svg>
);
export const IconPalette = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.2-1-1.6-1-2.6 0-.9.7-1.5 1.6-1.5h2.2a3.9 3.9 0 0 0 3.9-3.9C20.5 7 16.7 3.5 12 3.5Z" />
    <circle cx="7.8" cy="11" r="1" />
    <circle cx="10.5" cy="7.5" r="1" />
    <circle cx="14.8" cy="7.8" r="1" />
  </Svg>
);
export const IconLanguage = (p: P) => (
  <Svg {...p}>
    <path d="M4 5.5h9M8.5 3.5v2M6 5.5c.6 3.4 2.8 6 6 7.5M11 5.5c-.6 3.6-3 6.5-7 8" />
    <path d="m12.5 20.5 4-9 4 9M14 17.3h5" />
  </Svg>
);
export const IconFilter = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 5.5h15l-5.8 7v5.5l-3.4 1.5v-7z" />
  </Svg>
);
export const IconMore = (p: P) => (
  <Svg {...p}>
    <path d="M6 12h.01M12 12h.01M18 12h.01" strokeWidth={2.6} />
  </Svg>
);
export const IconPencil = (p: P) => (
  <Svg {...p}>
    <path d="M15.5 5.5 18.5 8.5 8.5 18.5H5.5v-3z" />
    <path d="m13.5 7.5 3 3" />
  </Svg>
);
export const IconUser = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 19.5c1.2-3.3 3.8-5 7-5s5.8 1.7 7 5" />
  </Svg>
);
export const IconCode = (p: P) => (
  <Svg {...p}>
    <path d="m9 7.5-4.5 4.5L9 16.5M15 7.5l4.5 4.5-4.5 4.5" />
  </Svg>
);
export const IconWebhook = (p: P) => (
  <Svg {...p}>
    <path d="M10 8.2a3.5 3.5 0 1 1 5.3 3M7.6 18.6a3.5 3.5 0 1 1 2.9-5.6M19 16.3a3.5 3.5 0 0 1-6 1.2" />
    <path d="M13.3 11.2 10.5 16M7.5 15.5h6M16 13.8l-2.8-4.6" />
  </Svg>
);
export const IconDatabase = (p: P) => (
  <Svg {...p}>
    <ellipse cx="12" cy="6.5" rx="7" ry="2.8" />
    <path d="M5 6.5v11c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-11M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" />
  </Svg>
);
export const IconClock = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);
export const IconWarning = (p: P) => (
  <Svg {...p}>
    <path d="M12 4.5 20.5 19h-17z" />
    <path d="M12 10v4M12 16.5h.01" />
  </Svg>
);
export const IconGithub = ({ size = 16, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...rest}>
    <path d="M12 2.5a9.5 9.5 0 0 0-3 18.5c.5.1.7-.2.7-.5v-1.7c-2.7.6-3.3-1.2-3.3-1.2-.4-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.1-.2-4.3-1.1-4.3-4.7 0-1 .4-1.9 1-2.6-.1-.2-.4-1.2.1-2.5 0 0 .8-.3 2.6 1a9 9 0 0 1 4.8 0c1.8-1.3 2.6-1 2.6-1 .5 1.3.2 2.3.1 2.5.6.7 1 1.6 1 2.6 0 3.7-2.2 4.5-4.3 4.7.3.3.6.9.6 1.8v2.6c0 .3.2.6.7.5A9.5 9.5 0 0 0 12 2.5Z" />
  </svg>
);
export const IconSlack = ({ size = 16, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...rest}>
    <path d="M9.2 3a1.8 1.8 0 0 0 0 3.6h1.8V4.8A1.8 1.8 0 0 0 9.2 3Zm0 4.8H4.8a1.8 1.8 0 0 0 0 3.6h4.4a1.8 1.8 0 0 0 0-3.6ZM21 9.6a1.8 1.8 0 0 0-3.6 0v1.8h1.8A1.8 1.8 0 0 0 21 9.6Zm-4.8 0V5a1.8 1.8 0 0 0-3.6 0v4.6a1.8 1.8 0 0 0 3.6 0ZM14.8 21a1.8 1.8 0 0 0 0-3.6H13v1.8a1.8 1.8 0 0 0 1.8 1.8Zm0-4.8h4.4a1.8 1.8 0 0 0 0-3.6h-4.4a1.8 1.8 0 0 0 0 3.6ZM3 14.4a1.8 1.8 0 0 0 3.6 0v-1.8H4.8A1.8 1.8 0 0 0 3 14.4Zm4.8 0V19a1.8 1.8 0 0 0 3.6 0v-4.6a1.8 1.8 0 0 0-3.6 0Z" />
  </svg>
);
export const IconLinear = ({ size = 16, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...rest}>
    <path d="M3.1 13.7 10.3 20.9a9 9 0 0 1-7.2-7.2Zm-.1-2.5 9.8 9.8a9 9 0 0 0 2.3-.4L3.4 8.9a9 9 0 0 0-.4 2.3Zm1.2-3.9 12.5 12.5c.6-.3 1.1-.7 1.6-1.1L5.3 5.7c-.4.5-.8 1-1.1 1.6Zm2.6-2.7A9 9 0 1 1 19.4 17.2Z" />
  </svg>
);
export const IconOpenAI = ({ size = 16, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden {...rest}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5 15.9 9.75v4.5L12 16.5l-3.9-2.25v-4.5z" />
  </svg>
);
export const IconMonitor = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="11.5" rx="1.5" />
    <path d="M9 19.5h6M12 16v3.5" />
  </Svg>
);
export const IconPhone = (p: P) => (
  <Svg {...p}>
    <rect x="7" y="3.5" width="10" height="17" rx="2" />
    <path d="M11 17.5h2" />
  </Svg>
);
