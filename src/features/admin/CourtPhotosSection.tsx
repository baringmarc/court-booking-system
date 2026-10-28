import { useState, type ChangeEvent } from 'react'
import { ErrorMessage } from '../../components/ErrorMessage'
import type { CourtWithPhotos } from '../catalog/api'
import { mediaUrl } from '../catalog/media'
import { useAddCourtPhoto, useRemoveCourtPhoto, useReorderCourtPhotos } from './hooks'
import { downscaleImage } from './imageResize'
import { ACCEPTED_IMAGE_TYPES, checkImageFile, COURT_PHOTO_MAX_WIDTH, MAX_UPLOAD_BYTES } from './mediaInput'
import { SortableList } from './SortableList'

export const MAX_COURT_PHOTOS = 6 // the database enforces the same limit (too_many_photos)

/** Prepares one picked file: checks it, then downscales it. Returns the image, or why it can't be used. */
async function prepare(file: File): Promise<{ image: Blob } | { problem: string }> {
  const problem = checkImageFile(file)
  if (problem) return { problem: `${file.name}: ${problem}` }
  let image: Blob
  try {
    image = await downscaleImage(file, COURT_PHOTO_MAX_WIDTH)
  } catch {
    return { problem: `${file.name}: That file isn't a readable image.` }
  }
  if (image.size > MAX_UPLOAD_BYTES) {
    return { problem: `${file.name}: Even after resizing, the image is larger than 2 MB. Try a smaller photo.` }
  }
  return { image }
}

/** A court's photo gallery (T9.7): up to 6 photos, the first is the cover. Add, remove and reorder. */
export function CourtPhotosSection({ court }: { court: CourtWithPhotos }) {
  const add = useAddCourtPhoto(court.id)
  const remove = useRemoveCourtPhoto(court.id)
  const reorder = useReorderCourtPhotos(court.id)
  const [uploading, setUploading] = useState(false)
  const [problems, setProblems] = useState<string[]>([])

  const photos = court.court_photos
  const free = MAX_COURT_PHOTOS - photos.length
  // Adding or removing changes the photo list, so reordering waits for it (its id list would be out of date),
  // and add/remove wait for a reorder. Reorders don't block each other: they queue (T9.4 pattern).
  const busy = uploading || add.isPending || remove.isPending
  const reordering = reorder.isPending
  const ids = photos.map((p) => p.id)

  async function handleFiles(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget
    const files = [...(input.files ?? [])]
    input.value = '' // so choosing the same file again still fires a change
    if (files.length === 0) return
    add.reset()
    remove.reset()
    const found: string[] = []
    if (files.length > free) {
      found.push(`Only ${free} more ${free === 1 ? 'photo fits' : 'photos fit'} (6 at most). The rest were skipped.`)
    }
    setUploading(true)
    // One at a time, each after the last photo, so the order matches the order the files were picked in.
    let next = Math.max(-1, ...photos.map((p) => p.sort_order)) + 1
    try {
      for (const file of files.slice(0, Math.max(free, 0))) {
        const prepared = await prepare(file)
        if ('problem' in prepared) {
          found.push(prepared.problem)
          continue
        }
        try {
          await add.mutateAsync({ image: prepared.image, sortOrder: next++ })
        } catch {
          break // the error is shown below; don't keep uploading after a failure
        }
      }
    } finally {
      setUploading(false)
      setProblems(found)
    }
  }

  const describedBy = problems.length ? 'court-photos-hint court-photos-problems' : 'court-photos-hint'

  return (
    <section className="card stack" aria-labelledby="court-photos-heading">
      <h2 id="court-photos-heading">Photos</h2>
      {photos.length === 0 ? (
        <p className="muted">No photos yet. Players see a placeholder for the sport.</p>
      ) : (
        // A grid of tiles, dragged in both directions (T11.5a). The first is the cover.
        <SortableList
          layout="grid"
          className="photo-grid"
          label={`Photos of ${court.name}, in order`}
          items={photos.map((photo, i) => ({ ...photo, label: `photo ${i + 1}` }))}
          disabled={busy}
          onReorder={(order) => reorder.mutate(order)}
          renderItem={(item, i) => {
            // The item, not photos[i]: during a keyboard pick-up `i` is the place in the preview order.
            const photo = photos.find((p) => p.id === item.id)!
            return (
            <div className="photo-tile">
              <img className="photo-thumb" src={mediaUrl(photo.path)} alt={`Photo ${i + 1} of ${court.name}`}
                width={160} height={90} />
              <span className="photo-row-label">
                {i === 0 ? <span className="badge status-confirmed">Cover</span> : <span className="muted small">Photo {i + 1}</span>}
              </span>
              <span className="photo-row-actions">
                {i > 0 && (
                  // aria-label starts with the visible words (label in name, WCAG 2.5.3) and says which photo.
                  <button type="button" className="btn btn-small btn-outline" aria-label={`Make cover: photo ${i + 1}`}
                    disabled={busy} onClick={() => reorder.mutate([photo.id, ...ids.filter((id) => id !== photo.id)])}>
                    Make cover
                  </button>
                )}
                <button type="button" className="btn btn-small btn-ghost" disabled={busy || reordering} aria-label={`Remove photo ${i + 1}`}
                  onClick={() => { add.reset(); remove.mutate(photo) }}>
                  Remove
                </button>
              </span>
            </div>
            )
          }}
        />
      )}

      <div className="field">
        <label htmlFor="court-photos-file">Add photos</label>
        <input id="court-photos-file" type="file" multiple accept={ACCEPTED_IMAGE_TYPES.join(',')}
          disabled={busy || reordering || free <= 0} aria-describedby={describedBy} onChange={handleFiles} />
        <p id="court-photos-hint" className="muted small">
          {free > 0
            ? `Up to 6 photos (${free} more ${free === 1 ? 'fits' : 'fit'}). JPG, PNG or WEBP, up to 15 MB each, resized to ${COURT_PHOTO_MAX_WIDTH} px wide. The first photo is the cover on court cards.`
            : 'This court has 6 photos, the most allowed. Remove one to add another.'}
        </p>
        {problems.length > 0 && (
          <ul id="court-photos-problems" className="form-error" role="alert">
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
      </div>
      {uploading && <p className="muted" role="status">Uploading…</p>}
      {add.error != null && <ErrorMessage error={add.error} />}
      {remove.error != null && <ErrorMessage error={remove.error} />}
      {reorder.error != null && <ErrorMessage error={reorder.error} />}
    </section>
  )
}
