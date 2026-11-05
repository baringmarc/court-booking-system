import { CONSOLE_PAGE_SIZE } from './api'

/** Previous/Next over a server-paged list (T17.19). `total` counts every matching record, not just this page. */
export function Pager({ label, page, total, onPage }: { label: string; page: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / CONSOLE_PAGE_SIZE))
  const first = total === 0 ? 0 : Math.min(total, (page - 1) * CONSOLE_PAGE_SIZE + 1)
  const last = Math.min(total, page * CONSOLE_PAGE_SIZE)
  return (
    <nav className="console-pager" aria-label={label}>
      <button type="button" className="btn btn-ghost btn-small" disabled={page <= 1} onClick={() => onPage(Math.min(page - 1, pages))}>Previous</button>
      <p className="muted small">
        <span>Page {page} of {pages}</span> · <span>{first > last ? `No records on this page of ${total}` : `Showing ${first}–${last} of ${total}`}</span>
      </p>
      <button type="button" className="btn btn-ghost btn-small" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </nav>
  )
}
