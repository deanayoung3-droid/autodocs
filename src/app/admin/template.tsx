// Templates re-mount on every navigation, so each admin page animates in.
export default function AdminTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
