import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <section className="page narrow">
      <h1>Page not found</h1>
      <p className="muted">That page doesn't exist.</p>
      <Link to="/" className="btn">Back to home</Link>
    </section>
  )
}
