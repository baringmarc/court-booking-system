export function ErrorMessage({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.'
  return (
    <div className="alert alert-error" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="btn btn-small btn-outline" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}
