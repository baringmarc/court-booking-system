import type { Review, ReviewFilter } from './api'
import { useReviewsPage, useSetReviewApproved } from './hooks'
import { DetailsButton, ListStatus, RecordPanel, SearchField, StatusBadge, StatusFilter } from './ListControls'
import { focusDetails, useListParams } from './listParams'
import { Pager } from './Pager'

const REVIEW_STATUSES = ['approved', 'hidden'] as const
const FILTER_OPTIONS = [['', 'All'], ['approved', 'Approved'], ['hidden', 'Hidden']] as const

function ReviewPanel({ review, onClose }: { review: Review; onClose: () => void }) {
  const set = useSetReviewApproved()
  return (
    <RecordPanel label={`Review from ${review.name}`} title={review.name} onClose={onClose}>
      <p className="muted">{review.role}{review.venue ? ` · ${review.venue}` : ''}</p>
      <p>Rating: {review.rating} of 5</p>
      <p>“{review.quote}”</p>
      <p className="muted">{review.approved ? 'Approved' : 'Hidden'}</p>
      <div className="form-actions">
        <button type="button" className="btn" disabled={set.isPending} onClick={() => set.mutate({ id: review.id, approved: !review.approved })}>
          {review.approved ? 'Hide' : 'Approve'}
        </button>
      </div>
      {set.error && <p className="form-error" role="alert">{set.error.message}</p>}
    </RecordPanel>
  )
}

/** The console's Reviews page (T15.4, routed and paged in T17.19): reviews from the marketing site, approved or hidden. */
export function ReviewsPage() {
  const { state, setFilter, setPage, setOpen } = useListParams(REVIEW_STATUSES)
  const approved: ReviewFilter = state.status === 'approved' || state.status === 'hidden' ? state.status : 'all'
  const reviews = useReviewsPage({ approved, search: state.q, page: state.page })
  const rows = reviews.data?.rows ?? []
  const open = rows.find((review) => review.id === state.open)
  const filtered = state.status !== '' || state.q !== ''

  return (
    <div className="stack console-page">
      <h1>Reviews</h1>
      <div className="console-filters">
        <SearchField id="review-search" label="Search reviews" value={state.q} onSearch={(q) => setFilter({ q })} />
        <StatusFilter id="review-filter" value={state.status} options={FILTER_OPTIONS} onChange={(status) => setFilter({ status })} />
      </div>
      <ListStatus noun="reviews" pending={reviews.isPending} error={reviews.error} onRetry={() => void reviews.refetch()}
        empty={reviews.isSuccess && reviews.data.total === 0} filtered={filtered ? 'No reviews match these filters.' : 'No reviews yet.'} />
      {reviews.data && reviews.data.total > 0 && (
        <div className={`console-records${open ? ' has-panel' : ''}`}>
          <div className="stack">
            <ul className="list console-rows">
              {rows.map((review) => (
                <li key={review.id} className="card console-row">
                  <div className="console-row-main">
                    <strong>{review.name}</strong>
                    <span className="muted small">{review.rating} of 5</span>
                  </div>
                  <StatusBadge status={review.approved ? 'approved' : 'hidden'}>{review.approved ? 'Approved' : 'Hidden'}</StatusBadge>
                  <DetailsButton id={review.id} name={review.name} onOpen={() => setOpen(review.id)} />
                </li>
              ))}
            </ul>
            <Pager label="Reviews pages" page={state.page} total={reviews.data.total} onPage={setPage} />
          </div>
          {open && <ReviewPanel key={open.id} review={open} onClose={() => { setOpen(null); focusDetails(open.id) }} />}
        </div>
      )}
    </div>
  )
}
