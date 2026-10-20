// Checks and size maths for venue media uploads (RESEARCH M6, "Image size"). The browser downscales and
// re-encodes every image before upload; the bucket re-checks type and size (2 MB) on the server.

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
/** Largest file we accept from the admin's device, before downscaling. */
export const MAX_SOURCE_BYTES = 15 * 1024 * 1024
/** Bucket limit, which applies to the downscaled file. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024

export const COURT_PHOTO_MAX_WIDTH = 1600
/** 2× the 1100 px page container. */
export const BANNER_MAX_WIDTH = 2200

/** A message for a file that can't be used, or null when it can be downscaled and uploaded. */
export function checkImageFile(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return 'Choose a JPG, PNG or WEBP image.'
  if (file.size > MAX_SOURCE_BYTES) return 'The image is larger than 15 MB.'
  return null
}

/** Size that fits within `maxWidth`, keeping the aspect ratio and never upscaling. */
export function fitWithin(width: number, height: number, maxWidth: number) {
  if (width <= maxWidth) return { width, height }
  return { width: maxWidth, height: Math.max(1, Math.round((height * maxWidth) / width)) }
}

const EXTENSIONS: Record<string, string> = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' }

/** A fresh object path, so cached copies of an old image are never served for a new one. */
export function newMediaPath(folder: string, type: string) {
  const ext = EXTENSIONS[type]
  if (!ext) throw new Error(`Unsupported image type: ${type}`)
  return `${folder}/${crypto.randomUUID()}.${ext}`
}

const STORAGE_MESSAGES: Record<string, string> = {
  '403': "You don't have permission to change venue media.",
  '413': 'The image is larger than 2 MB.',
  '415': 'Only JPG, PNG and WEBP images can be uploaded.',
}

export const STORAGE_GENERIC_MESSAGE = "The image couldn't be saved. Please try again."

/**
 * A readable message for a Storage API error, keyed by its HTTP status. An unmapped status gets a generic line; with no
 * status at all (the request never got an answer) the original message is kept, so errorMessage() can report the
 * network failure.
 */
export function storageErrorMessage(error: { message: string; statusCode?: string | number; status?: number }) {
  const code = String(error.statusCode ?? error.status ?? '')
  if (!code) return error.message
  return STORAGE_MESSAGES[code] ?? STORAGE_GENERIC_MESSAGE
}

export const BANNER_ALT_MAX = 200

/** The banner's alt text is required while a banner is set (stored trimmed, 1–200 characters). */
export function validateBannerAlt(alt: string): string | null {
  const trimmed = alt.trim()
  if (!trimmed) return "Describe the banner image for people who can't see it."
  if (trimmed.length > BANNER_ALT_MAX) return `Use at most ${BANNER_ALT_MAX} characters.`
  return null
}
