import { useState, type ChangeEvent, type FormEvent } from 'react'
import { SaveStatus } from '../../components/SaveStatus'
import type { VenueSettings } from '../catalog/api'
import { mediaUrl } from '../catalog/media'
import { ConfirmDialog } from './ConfirmDialog'
import { useRemoveLogo, useSaveLogo } from './hooks'
import type { LogoInput } from './api'
import { cropSquareImage } from './imageResize'
import { useSettingsDirty } from './settingsDraft'
import { ACCEPTED_IMAGE_TYPES, checkImageFile, LOGO_SIZE, MAX_UPLOAD_BYTES } from './mediaInput'

/** The venue's square logo, shown on its live stacks (T29.6, SPEC §7). */
export function LogoSection({ settings }: { settings: VenueSettings }) {
  const setDirty = useSettingsDirty('logo')
  const save = useSaveLogo(settings)
  const remove = useRemoveLogo(settings)
  const [confirming, setConfirming] = useState(false)
  const busy = save.isPending || remove.isPending

  function handleSave(input: LogoInput) {
    remove.reset()
    save.mutate(input, { onSuccess: () => setDirty(false) })
  }

  function confirmRemove() {
    setConfirming(false)
    save.reset()
    remove.mutate()
  }

  return (
    <section className="card stack" aria-labelledby="logo-heading">
      <h2 id="logo-heading">Venue logo</h2>
      <p className="muted small">Optional. Shown on your venue's live stacks, the Paddle Stack boards players follow on their phones.</p>
      {settings.logo_path && (
        <img className="logo-preview" src={mediaUrl(settings.logo_path)} alt={`${settings.name.trim()} logo`} width={128} height={128} />
      )}
      {/* Remount after each save or remove so the form starts from what's stored. */}
      <LogoForm key={settings.logo_path ?? 'none'} hasLogo={!!settings.logo_path} busy={busy} saving={save.isPending} onSave={handleSave} />
      <div className="form-actions">
        {settings.logo_path && (
          <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setConfirming(true)}>
            {remove.isPending ? 'Removing…' : 'Remove logo'}
          </button>
        )}
        <SaveStatus isSuccess={save.isSuccess || remove.isSuccess} error={save.error ?? remove.error} />
      </div>
      {confirming && (
        <ConfirmDialog id="remove-logo" title="Remove the logo?" body="Live stacks will show the venue's name without a logo."
          stay="Keep logo" confirm="Remove it" onStay={() => setConfirming(false)} onConfirm={confirmRemove} />
      )}
    </section>
  )
}

type FormProps = { hasLogo: boolean; busy: boolean; saving: boolean; onSave: (input: LogoInput) => void }

function LogoForm({ hasLogo, busy, saving, onSave }: FormProps) {
  const setDirty = useSettingsDirty('logo')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const disabled = busy || processing

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const chosen = e.currentTarget.files?.[0] ?? null
    setFile(chosen)
    setDirty(true)
    setError(chosen ? checkImageFile(chosen) : null)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const fileError = file ? checkImageFile(file) : 'Choose an image for the logo.'
    setError(fileError)
    if (fileError || !file) return

    setProcessing(true)
    let image: Blob
    try {
      image = await cropSquareImage(file, LOGO_SIZE)
    } catch (err) {
      setError(err instanceof Error ? err.message : "That file isn't a readable image.")
      return
    } finally {
      setProcessing(false)
    }
    if (image.size > MAX_UPLOAD_BYTES) {
      setError('Even after resizing, the image is larger than 2 MB. Try a smaller image.')
      return
    }
    onSave({ image })
  }

  return (
    <form className="stack" onSubmit={handleSubmit} noValidate aria-label="Logo">
      <div className="field">
        <label htmlFor="logo-file">{hasLogo ? 'Replace image' : 'Logo image'}</label>
        <input id="logo-file" type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} disabled={disabled}
          aria-invalid={error ? true : undefined} aria-describedby={error ? 'logo-file-hint logo-file-error' : 'logo-file-hint'}
          onChange={handleFile} />
        <p id="logo-file-hint" className="muted small">
          A square JPG, PNG or WEBP works best, up to 15 MB. Other shapes are cropped to the middle square and resized to {LOGO_SIZE} × {LOGO_SIZE} px.
        </p>
        {error && <p id="logo-file-error" className="form-error" role="alert">{error}</p>}
      </div>
      <div className="form-actions">
        <button type="submit" className="btn" disabled={disabled}>
          {processing || saving ? 'Saving…' : 'Save logo'}
        </button>
      </div>
    </form>
  )
}
