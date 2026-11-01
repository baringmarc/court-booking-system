import type { Review } from './api'
import { useReviews, useSetReviewApproved } from './hooks'

function ReviewItem({ review }: { review: Review }) {
  const set = useSetReviewApproved()
  return (
    <li className="card stack">
      <strong>{review.name}</strong>
      <p className="muted">{review.role}{review.venue ? ` · ${review.venue}` : ''}</p>
      <p>Rating: {review.rating} of 5</p>
      <p>“{review.quote}”</p>
      <p className="muted">{review.approved ? 'Approved' : 'Hidden'}</p>
      <div className="form-actions">
        <button
          type="button"
          className="btn"
          disabled={set.isPending}
          onClick={() => set.mutate({ id: review.id, approved: !review.approved })}
        >
          {review.approved ? 'Hide' : 'Approve'}
        </button>
      </div>
      {set.error && <p className="form-error" role="alert">{set.error.message}</p>}
    </li>
  )
}

/** The console's reviews section (T15.4): reviews sent from the marketing site, approved or hidden by a platform admin. */
export function ReviewsInbox() {
  const reviews = useReviews()
  return (
    <section className="stack" aria-labelledby="reviews-heading">
      <h2 id="reviews-heading">Reviews</h2>
      {reviews.isPending ? (
        <p className="muted">Loading reviews…</p>
      ) : reviews.error ? (
        <div className="alert alert-error">
          <p>Couldn't load reviews.</p>
          <button type="button" className="btn btn-ghost" onClick={() => void reviews.refetch()}>Retry</button>
        </div>
      ) : reviews.data.length === 0 ? (
        <p className="muted">No reviews yet.</p>
      ) : (
        <ul className="list">
          {reviews.data.map((review) => <ReviewItem key={review.id} review={review} />)}
        </ul>
      )}
    </section>
  )
}
