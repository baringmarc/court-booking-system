/** Placeholder for routes that later milestones will build. */
export function ComingSoon({ title, milestone }: { title: string; milestone: number }) {
  return (
    <section className="page">
      <h1>{title}</h1>
      <p className="muted">Coming in milestone {milestone} (see SPEC.md §9).</p>
    </section>
  )
}
