export function PageLoader() {
  return (
    <div className="page-loader" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span className="sr-only">Loading…</span>
    </div>
  )
}
