import Image from "next/image";
import Link from "next/link";

type CustomerAppHeaderProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actionHref?: string;
  actionLabel?: string;
};

export default function CustomerAppHeader({
  eyebrow = "MOOVU Kasi Rides",
  title,
  subtitle,
  actionHref,
  actionLabel,
}: CustomerAppHeaderProps) {
  return (
    <header className="moovu-customer-header">
      <div className="flex min-w-0 items-center gap-3">
        <div className="moovu-customer-logo-box">
          <Image src="/logo.png" alt="MOOVU Kasi Rides" width={72} height={72} priority />
        </div>
        <div className="min-w-0">
          <div className="moovu-kicker">{eyebrow}</div>
          <h1 className="mt-1 text-2xl font-black leading-tight tracking-tight text-slate-950">
            {title}
          </h1>
          {subtitle ? <p className="mt-1 text-sm text-slate-600">{subtitle}</p> : null}
        </div>
      </div>

      {actionHref && actionLabel ? (
        <Link href={actionHref} className="moovu-header-action">
          {actionLabel}
        </Link>
      ) : null}
    </header>
  );
}
