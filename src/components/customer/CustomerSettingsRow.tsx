import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
type Props = { href?: string; icon: LucideIcon; label: string; detail?: string; danger?: boolean; onClick?: () => void };
export default function CustomerSettingsRow({ href, icon: Icon, label, detail, danger, onClick }: Props) {
  const content = <><span className="customer-settings-icon"><Icon aria-hidden="true" /></span><span className="customer-settings-copy"><strong>{label}</strong>{detail ? <small>{detail}</small> : null}</span><ChevronRight className="customer-settings-chevron" aria-hidden="true" /></>;
  const className = danger ? "customer-settings-row is-danger" : "customer-settings-row";
  return href ? <Link href={href} className={className}>{content}</Link> : <button type="button" className={className} onClick={onClick}>{content}</button>;
}
