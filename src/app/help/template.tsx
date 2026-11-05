// Re-mounts on every navigation, so each help center page animates in.
export default function HelpTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
