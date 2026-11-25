export function driverArchiveHref(name: string) {
  return `/admin/archive?${new URLSearchParams({ q: name })}`;
}

export function archiveQuery(params: Pick<URLSearchParams, "get">) {
  return params.get("q") ?? "";
}

export function archiveRequest({ q, status, dateFrom, dateTo, page }: {
  q: string; status: string; dateFrom: string; dateTo: string; page: number;
}) {
  const params = new URLSearchParams({ page: String(page), pageSize: "25" });
  if (q.trim()) params.set("q", q.trim());
  if (status) params.set("status", status);
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);
  return `/api/admin/archive?${params}`;
}
