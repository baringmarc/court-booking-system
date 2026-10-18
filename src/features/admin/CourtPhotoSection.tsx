import { useState, type ChangeEvent } from 'react'
import { SaveStatus } from '../../components/SaveStatus'
import type { Court } from '../catalog/api'
import { mediaUrl } from '../catalog/media'
import { useRemoveCourtPhoto, useSetCourtPhoto } from './hooks'
import { downscaleImage } from './imageResize'
import { ACCEPTED_IMAGE_TYPES, checkImageFile, COURT_PHOTO_MAX_WIDTH, MAX_UPLOAD_BYTES } from './mediaInput'

/** Upload, replace or remove a court's photo. The image is checked and downscaled before it's sent. */
export function CourtPhotoSection({ court }: { court: Court }) {
  const setPhoto = useSetCourtPhoto(court)
  const removePhoto = useRemoveCourtPhoto(court)
  const [processing, setProcessing] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const busy = processing || setPhoto.isPending || removePhoto.isPending

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget
    const file = input.files?.[0]
    input.value = '' // so choosing the same file again still fires a change
    if (!file) return
    setPhoto.reset()
    removePhoto.reset()
    const problem = checkImageFile(file)
    setFileError(problem)
    if (problem) return

    setProcessing(true)
    let image: Blob
    try {
      image = await downscaleImage(file, COURT_PHOTO_MAX_WIDTH)
    } catch (err) {
      setFileError(err instanceof Error ? err.message : "That file isn't a readable image.")
      return
    } finally {
      setProcessing(false)
    }
    if (image.size > MAX_UPLOAD_BYTES) {
      setFileError('Even after resizing, the image is larger than 2 MB. Try a smaller photo.')
      return
    }
    setPhoto.mutate(image)
  }

  function handleRemove() {
    setFileError(null)
    setPhoto.reset()
    removePhoto.mutate()
  }

  const describedBy = fileError ? 'court-photo-hint court-photo-error' : 'court-photo-hint'

  return (
    <section className="card stack" aria-labelledby="court-photo-heading">
      <h2 id="court-photo-heading">Photo</h2>
      {court.photo_path ? (
        <img className="media-preview" src={mediaUrl(court.photo_path)} alt={`Photo of ${court.name}`} width={1600} height={900} />
      ) : (
        <p className="muted">No photo yet. Players see a placeholder for the sport.</p>
      )}
      <div className="field">
        <label htmlFor="court-photo-file">{court.photo_path ? 'Replace photo' : 'Upload a photo'}</label>
        <input id="court-photo-file" type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} disabled={busy}
          aria-invalid={fileError ? true : undefined} aria-describedby={describedBy} onChange={handleFile} />
        <p id="court-photo-hint" className="muted small">
          JPG, PNG or WEBP, up to 15 MB. It's resized to {COURT_PHOTO_MAX_WIDTH} px wide and shown at 16:9 on court cards.
        </p>
        {fileError && <p id="court-photo-error" className="form-error" role="alert">{fileError}</p>}
      </div>
      <div className="form-actions">
        {court.photo_path && (
          <button type="button" className="btn btn-outline" disabled={busy} onClick={handleRemove}>
            {removePhoto.isPending ? 'Removing…' : 'Remove photo'}
          </button>
        )}
        {(processing || setPhoto.isPending) && <span className="muted" role="status">Uploading…</span>}
        <SaveStatus isSuccess={setPhoto.isSuccess || removePhoto.isSuccess} error={setPhoto.error ?? removePhoto.error} />
      </div>
    </section>
  )
}
