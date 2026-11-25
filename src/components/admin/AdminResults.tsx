import { pageTarget } from "@/lib/admin/resultNavigation";
import type { ReactNode } from "react";

export function AdminFilters({ label, children }: { label: string; children: ReactNode }) {
  return <section aria-label={label} className="moovu-card space-y-3 p-4">{children}</section>;
}

export function AdminResultCount({ count, label }: { count: number | null; label: string }) {
  return <span>{count === null ? `${label} unavailable` : `${count} ${label}`}</span>;
}

export function AdminPagination({ label, page, count, busy, hasNext, onPage }: {
  label: string; page: number; count: number | null; busy?: boolean; hasNext: boolean;
  onPage: (page: number) => void;
}) {
  const previous = pageTarget(page, -1, Boolean(busy), hasNext);
  const next = pageTarget(page, 1, Boolean(busy), hasNext);
  return <nav aria-label={`${label} pagination`} aria-busy={busy} className="flex flex-wrap items-center gap-3 p-3">
    <button type="button" aria-label={`Previous ${label} page`} className="moovu-btn moovu-btn-secondary"
      disabled={previous === null} onClick={() => { if (previous !== null) onPage(previous); }}>Previous</button>
    <span>Page {page} · <AdminResultCount count={count} label={label} /></span>
    <button type="button" aria-label={`Next ${label} page`} className="moovu-btn moovu-btn-secondary"
      disabled={next === null} onClick={() => { if (next !== null) onPage(next); }}>Next</button>
  </nav>;
}

export function AdminTableRegion({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return <div className={`overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600 ${className}`}
    role="region" aria-label={label} tabIndex={0}>{children}</div>;
}
