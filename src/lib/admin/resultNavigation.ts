export function pageTarget(page: number, delta: -1 | 1, busy: boolean, hasNext: boolean) {
  if (busy || (delta === -1 ? page <= 1 : !hasNext)) return null;
  return page + delta;
}

export function dispatchPageControls(page: number, loadedPage: number | undefined, filtersMatch: boolean, total: number | null, visible: number) {
  return {
    busy: !filtersMatch || page !== loadedPage,
    hasNext: total == null ? visible === 50 : page * 50 < total,
  };
}

export function dispatchBoardParams(openPage: number, closedPage: number, q: string, status: string, queue: string) {
  return new URLSearchParams({ openPage: String(openPage), closedPage: String(closedPage), q, status, queue });
}
