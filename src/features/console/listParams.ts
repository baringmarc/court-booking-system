import { useSearchParams } from 'react-router-dom'
import { resetPage } from './paging'

/** A console list's view state lives in the URL (T17.19): `q`, `status`, `month`, `page` and `open`. */
export type ListState = { q: string; status: string; month: string; page: number; open: string | null }

function pageOf(value: string | null): number {
  const n = Number(value)
  return Number.isInteger(n) && n > 1 ? n : 1
}

/**
 * Reads and writes the list state. Every change pushes a history entry, so Back returns to the previous filter, page
 * or panel. A filter or search change starts again at page 1 (`resetPage`); page 1 and blank values stay out of the URL.
 * `statuses` lists the accepted `status` values; anything else reads as "All" (blank).
 */
export function useListParams(statuses: readonly string[]) {
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? ''
  const month = params.get('month') ?? ''
  const state: ListState = {
    q: params.get('q') ?? '',
    status: statuses.includes(status) ? status : '',
    month: /^\d{4}-\d{2}-01$/.test(month) ? month : '',
    page: pageOf(params.get('page')),
    open: params.get('open') || null,
  }

  function write(next: ListState) {
    const out = new URLSearchParams()
    if (next.q !== '') out.set('q', next.q)
    if (next.status !== '') out.set('status', next.status)
    if (next.month !== '') out.set('month', next.month)
    if (next.page > 1) out.set('page', String(next.page))
    if (next.open) out.set('open', next.open)
    setParams(out)
  }

  return {
    state,
    /** A new search, status or month: back to page 1, panel kept. */
    setFilter: (changes: Partial<Pick<ListState, 'q' | 'status' | 'month'>>) => write(resetPage({ ...state, ...changes })),
    setPage: (page: number) => write({ ...state, page }),
    setOpen: (open: string | null) => write({ ...state, open }),
    /** Page and panel in one history entry (closing a deleted record's panel and stepping back a page). */
    setView: (changes: Partial<Pick<ListState, 'page' | 'open'>>) => write({ ...state, ...changes }),
  }
}

/** The id of a compact row's Details button, so a closing panel can hand focus back to it. */
export function detailsButtonId(recordId: string): string {
  return `details-${recordId}`
}

/** Returns focus to the row a panel came from (when that row is still on the page). */
export function focusDetails(recordId: string) {
  document.getElementById(detailsButtonId(recordId))?.focus()
}

/** Focuses the element with `id` (the button that opened a dialog), when it is still on the page. */
export function returnFocus(id: string) {
  document.getElementById(id)?.focus()
}
