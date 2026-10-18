import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { PageLoader } from '../../components/PageLoader'
import { ErrorMessage } from '../../components/ErrorMessage'
import { SaveStatus } from '../../components/SaveStatus'
import { useCourt, useSaveCourt } from '../catalog/hooks'
import { SPORT_LABELS, SPORTS, type Court, type Sport } from '../catalog/api'
import { CourtPhotoSection } from './CourtPhotoSection'
import { CourtRatesSection } from './CourtRatesSection'

export function CourtEditPage() {
  const { id } = useParams()
  const isNew = id === 'new'
  const court = useCourt(isNew ? undefined : id)

  return (
    <section className="page">
      <p><Link to="/admin/courts">← All courts</Link></p>
      {isNew ? (
        <>
          <h1>Add court</h1>
          <CourtForm court={null} />
        </>
      ) : court.isPending ? (
        <PageLoader />
      ) : court.isError ? (
        <ErrorMessage error={court.error} onRetry={() => court.refetch()} />
      ) : (
        <>
          <h1>{court.data.name}</h1>
          <CourtForm key={court.data.id} court={court.data} />
          <CourtPhotoSection court={court.data} />
          <CourtRatesSection court={court.data} />
        </>
      )}
    </section>
  )
}

function CourtForm({ court }: { court: Court | null }) {
  const navigate = useNavigate()
  const save = useSaveCourt(court?.id ?? null)

  const [name, setName] = useState(court?.name ?? '')
  const [sport, setSport] = useState<Sport>(court?.sport ?? 'badminton')
  const [description, setDescription] = useState(court?.description ?? '')
  const [rate, setRate] = useState(court ? String(court.default_hourly_rate) : '')
  const [sortOrder, setSortOrder] = useState(String(court?.sort_order ?? 0))
  const [isActive, setIsActive] = useState(court?.is_active ?? true)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    save.mutate(
      {
        name: name.trim(),
        sport,
        description: description.trim(),
        default_hourly_rate: Number(rate),
        sort_order: Number(sortOrder) || 0,
        is_active: isActive,
      },
      {
        // New court: go to its page so rates can be set.
        onSuccess: (saved) => {
          if (!court) navigate(`/admin/courts/${saved.id}`, { replace: true })
        },
      },
    )
  }

  return (
    <form className="card stack" onSubmit={handleSubmit}>
      <h2>Details</h2>
      <div className="form-grid">
        <label className="field">
          <span>Name</span>
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Sport</span>
          <select value={sport} onChange={(e) => setSport(e.target.value as Sport)}>
            {SPORTS.map((s) => <option key={s} value={s}>{SPORT_LABELS[s]}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Default hourly rate</span>
          <input type="number" min={0} step="0.01" required inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </label>
        <label className="field">
          <span>Display order</span>
          <input type="number" step={1} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>Description</span>
        <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        <span>Active (bookable and shown to the public). Uncheck to archive.</span>
      </label>
      <div className="form-actions">
        <button type="submit" className="btn" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : court ? 'Save changes' : 'Create court'}
        </button>
        <SaveStatus isSuccess={save.isSuccess && !!court} error={save.error} />
      </div>
    </form>
  )
}
