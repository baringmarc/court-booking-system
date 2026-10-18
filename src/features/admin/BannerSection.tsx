import { useState, type ChangeEvent, type FormEvent } from 'react'
import { SaveStatus } from '../../components/SaveStatus'
import type { VenueSettings } from '../catalog/api'
import { mediaUrl } from '../catalog/media'
import { useRemoveBanner, useSaveBanner } from './hooks'
import type { BannerInput } from './api'
import { downscaleImage } from './imageResize'
import {
  ACCEPTED_IMAGE_TYPES,
  BANNER_ALT_MAX,
  BANNER_MAX_WIDTH,
  checkImageFile,
  MAX_UPLOAD_BYTES,
  validateBannerAlt,
} from './mediaInput'

/** The optional home page banner: an image with required alt text (SPEC §7). */
export function BannerSection({ settings }: { settings: VenueSettings }) {
  const save = useSaveBanner(settings)
  const remove = useRemoveBanner(settings)

  function handleSave(input: BannerInput) {
    remove.reset()
    save.mutate(input)
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
type Errors = { alt?: string; file?: string }

function BannerForm({ settings, busy, saving, onSave }: FormProps) {
  const hasBanner = !!settings.banner_path
  const [alt, setAlt] = useState(settings.banner_alt ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [errors, setErrors] = useState<Errors>({})
  const [processing, setProcessing] = useState(false)
  const disabled = busy || processing

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const chosen = e.currentTarget.files?.[0] ?? null
    setFile(chosen)
    setErrors((prev) => ({ ...prev, file: chosen ? checkImageFile(chosen) ?? undefined : undefined }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const next: Errors = {
      alt: validateBannerAlt(alt) ?? undefined,
      file: file ? checkImageFile(file) ?? undefined : hasBanner ? undefined : 'Choose an image for the banner.',
    }
    setErrors(next)
    if (next.alt || next.file) return
    const bannerAlt = alt.trim() // the database stores it trimmed
    if (!file) {
      onSave({ alt: bannerAlt })
      return
    }

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
    onSave({ alt: bannerAlt, image })
  }

  const describedBy = (key: keyof Errors, hint: string) => (errors[key] ? `${hint} banner-${key}-error` : hint)

  return (
    <form className="stack" onSubmit={handleSubmit} noValidate aria-label="Banner">
      <div className="field">
        <label htmlFor="banner-file">{hasBanner ? 'Replace image (optional)' : 'Banner image'}</label>
        <input id="banner-file" type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} disabled={disabled}
          aria-invalid={errors.file ? true : undefined} aria-describedby={describedBy('file', 'banner-file-hint')}
          onChange={handleFile} />
        <p id="banner-file-hint" className="muted small">
          A landscape JPG, PNG or WEBP of at least 1600 × 600, up to 15 MB. It's resized to {BANNER_MAX_WIDTH} px wide and
          cropped to 3:1 on desktop and 2:1 on phones.
        </p>
        {errors.file && <p id="banner-file-error" className="form-error" role="alert">{errors.file}</p>}
      </div>
      <div className="field">
        <label htmlFor="banner-alt">Alt text</label>
        <input id="banner-alt" value={alt} maxLength={BANNER_ALT_MAX + 50} disabled={disabled}
          aria-invalid={errors.alt ? true : undefined} aria-describedby={describedBy('alt', 'banner-alt-hint')}
          onChange={(e) => setAlt(e.target.value)} />
        <p id="banner-alt-hint" className="muted small">
          Describe what the picture shows, for people who can't see it. Required, up to {BANNER_ALT_MAX} characters.
        </p>
        {errors.alt && <p id="banner-alt-error" className="form-error" role="alert">{errors.alt}</p>}
      </div>
      <div className="form-actions">
        <button type="submit" className="btn" disabled={disabled}>
          {processing || saving ? 'Saving…' : 'Save banner'}
        </button>
      </div>
    </form>
  )
}
