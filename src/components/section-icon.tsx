// Line icons for help center sections, from Lucide (lucide.dev, ISC license): one consistent,
// carefully drawn set. A section's icon is stored as one of the names below; anything else (an
// emoji, from before icons existed) is shown as text. The names are what's saved, so keep them.

import {
  AppWindow,
  ArrowRightLeft,
  BookOpen,
  Briefcase,
  Calendar,
  ChartColumn,
  CircleHelp,
  Clock,
  Contact,
  CreditCard,
  FileText,
  Folder,
  Globe,
  Inbox,
  Landmark,
  ListChecks,
  Lock,
  Mail,
  MessageSquare,
  PenLine,
  Plug,
  Rocket,
  Scale,
  Settings,
  Shield,
  Star,
  Users,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  book: BookOpen,
  rocket: Rocket,
  calendar: Calendar,
  briefcase: Briefcase,
  users: Users,
  contact: Contact,
  chat: MessageSquare,
  tasks: ListChecks,
  mail: Mail,
  folder: Folder,
  pen: PenLine,
  card: CreditCard,
  bank: Landmark,
  inbox: Inbox,
  portal: AppWindow,
  scale: Scale,
  clock: Clock,
  chart: ChartColumn,
  gear: Settings,
  wrench: Wrench,
  migrate: ArrowRightLeft,
  lock: Lock,
  shield: Shield,
  bolt: Zap,
  plug: Plug,
  globe: Globe,
  help: CircleHelp,
  file: FileText,
  star: Star,
};

/** Names in the order the picker shows them. */
export const SECTION_ICONS = Object.keys(ICONS);

export function SectionIcon({ value, size = 16, className = "" }: { value: string | null | undefined; size?: number; className?: string }) {
  const Icon = ICONS[value || "book"];
  if (!Icon) {
    return (
      <span className={`inline-flex shrink-0 items-center justify-center leading-none ${className}`} style={{ fontSize: size, width: size, height: size }} aria-hidden>
        {value}
      </span>
    );
  }
  // Lucide draws at stroke 2 on 24px; thinner reads better at the help center's larger card size.
  return <Icon size={size} strokeWidth={size >= 24 ? 1.5 : 1.75} className={`shrink-0 ${className}`} aria-hidden />;
}
