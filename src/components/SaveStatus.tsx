/** Inline feedback next to a Save button, driven by a React Query mutation's state. */
export function SaveStatus({ isSuccess, error }: { isSuccess: boolean; error: Error | null }) {
  if (error) return <span className="form-error" role="alert">{error.message}</span>
  if (isSuccess) return <span className="save-ok" role="status">Saved</span>
  return null
}
