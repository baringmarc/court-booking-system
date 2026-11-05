/** Filter changes start again at page 1, so a narrower filter never lands on an empty page past its end. */
export function resetPage<T extends { page: number }>(filters: T): T {
  return { ...filters, page: 1 }
}
