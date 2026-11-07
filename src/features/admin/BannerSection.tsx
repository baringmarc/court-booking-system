import { useState, type ChangeEvent, type FormEvent } from 'react'
import { SaveStatus } from '../../components/SaveStatus'
import type { VenueSettings } from '../catalog/api'
import { mediaUrl } from '../catalog/media'
import { useRemoveBanner, useSaveBanner } from './hooks'
import type { BannerInput } from './api'
import { downscaleImage } from './imageResize'
import { useSettingsDirty } from './settingsDraft'
import {
  ACCEPTED_IMAGE_TYPES,
  BANNER_MAX_WIDTH,
  checkImageFile,
  MAX_UPLOAD_BYTES,
} from './mediaInput'

const ALT_MAX = 200 // the venue_settings CHECK

/** The alt text the banner gets without asking the owner: the stored one, else "<venue name> banner". */
function bannerAlt(settings: VenueSettings) {
  if (settings.banner_path && settings.banner_alt) return settings.banner_alt
  const suffix = ' banner'
  return `${settings.name.trim().slice(0, ALT_MAX - suffix.length).trim()}${suffix}`.trim()
}

/** The optional home page banner: just an image; its alt text is set automatically (SPEC §7). */
export function BannerSection({ settings }: { settings: VenueSettings }) {
  const setDirty = useSettingsDirty('banner')
  const save = useSaveBanner(settings)
  const remove = useRemoveBanner(settings)

  function handleSave(input: BannerInput) {
    remove.reset()
    save.mutate(input, { onSuccess: () => setDirty(false) })
  }

  function handleRemove() {
    save.reset()
    remove.mutate()
  }

  return (
    <section className="card stack" aria-labelledby="banner-heading">
      <h2 id="banner-heading">Home page banner</h2>
      <p className="muted small">
        Optional. Shown on the home page just below the header; nothing is shown when there's no banner.
      </p>
      {settings.banner_path && settings.banner_alt && (
        <div className="banner-previews">
          <figure>
            <img className="banner-preview banner-preview-wide" src={mediaUrl(settings.banner_path)} alt={settings.banner_alt} width={1200} height={400} />
            <figcaption className="muted small">Desktop (3:1)</figcaption>
          </figure>
          <figure>
            {/* Same image, phone crop; decorative so screen readers hear the alt text once. */}
            <img className="banner-preview banner-preview-narrow" src={mediaUrl(settings.banner_path)} alt="" width={600} height={300} />
            <figcaption className="muted small">Phone (2:1)</figcaption>
          </figure>
        </div>
      )}
      {/* Remount after each save or remove so the form starts from what's stored. */}
      <BannerForm
        key={`${settings.banner_path ?? 'none'}|${settings.banner_alt ?? ''}`}
        settings={settings}
        busy={save.isPending || remove.isPending}
        saving={save.isPending}
        onSave={handleSave}
      />
      <div className="form-actions">
        {settings.banner_path && (
          <button type="button" className="btn btn-outline" disabled={save.isPending || remove.isPending} onClick={handleRemove}>
            {remove.isPending ? 'Removing…' : 'Remove banner'}
          </button>
        )}
        <SaveStatus isSuccess={save.isSuccess || remove.isSuccess} error={save.error ?? remove.error} />
      </div>
    </section>
  )
}

type FormProps = { settings: VenueSettings; busy: boolean; saving: boolean; onSave: (input: BannerInput) => void }
type Errors = { file?: string }

function BannerForm({ settings, busy, saving, onSave }: FormProps) {
  const setDirty = useSettingsDirty('banner')
  const hasBanner = !!settings.banner_path
  const [file, setFile] = useState<File | null>(null)
  const [errors, setErrors] = useState<Errors>({})
  const [processing, setProcessing] = useState(false)
  const disabled = busy || processing

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const chosen = e.currentTarget.files?.[0] ?? null
    setFile(chosen)
    setDirty(true)
    setErrors((prev) => ({ ...prev, file: chosen ? checkImageFile(chosen) ?? undefined : undefined }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const fileError = file ? checkImageFile(file) : 'Choose an image for the banner.'
    setErrors({ file: fileError ?? undefined })
    if (fileError || !file) return

    setProcessing(true)
    let image: Blob
    try {
      image = await downscaleImage(file, BANNER_MAX_WIDTH)
    } catch (err) {
      setErrors({ file: err instanceof Error ? err.message : "That file isn't a readable image." })
      return
    } finally {
      setProcessing(false)
    }
    if (image.size > MAX_UPLOAD_BYTES) {
      setErrors({ file: 'Even after resizing, the image is larger than 2 MB. Try a smaller image.' })
      return
    }
    onSave({ alt: bannerAlt(settings), image })
  }

  const describedBy = (key: keyof Errors, hint: string) => (errors[key] ? `${hint} banner-${key}-error` : hint)

  return (
    <form className="stack" onSubmit={handleSubmit} noValidate aria-label="Banner">
      <div className="field">
        <label htmlFor="banner-file">{hasBanner ? 'Replace image' : 'Banner image'}</label>
        <input id="banner-file" type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} disabled={disabled}
          aria-invalid={errors.file ? true : undefined} aria-describedby={describedBy('file', 'banner-file-hint')}
          onChange={handleFile} />
        <p id="banner-file-hint" className="muted small">
          A landscape JPG, PNG or WEBP of at least 1600 × 600, up to 15 MB. It's resized to {BANNER_MAX_WIDTH} px wide and
          cropped to 3:1 on desktop and 2:1 on phones.
        </p>
        {errors.file && <p id="banner-file-error" className="form-error" role="alert">{errors.file}</p>}
      </div>
      <div className="form-actions">
        <button type="submit" className="btn" disabled={disabled}>
          {processing || saving ? 'Saving…' : 'Save banner'}
        </button>
      </div>
    </form>
  )
}
