import { describe, expect, it } from 'vitest'
import { checkImageFile, fitWithin, MAX_SOURCE_BYTES, newMediaPath, storageErrorMessage, validateBannerAlt } from './mediaInput'

const file = (type: string, size = 1000) => {
  const f = new File([new Uint8Array(1)], 'x', { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

describe('checkImageFile', () => {
  it('accepts JPG, PNG and WEBP up to 15 MB', () => {
    expect(checkImageFile(file('image/jpeg'))).toBeNull()
    expect(checkImageFile(file('image/png'))).toBeNull()
    expect(checkImageFile(file('image/webp', MAX_SOURCE_BYTES))).toBeNull()
  })

  it('refuses other types, including SVG and GIF', () => {
    expect(checkImageFile(file('image/svg+xml'))).toBe('Choose a JPG, PNG or WEBP image.')
    expect(checkImageFile(file('image/gif'))).toBe('Choose a JPG, PNG or WEBP image.')
    expect(checkImageFile(file(''))).toBe('Choose a JPG, PNG or WEBP image.')
  })

  it('refuses files over 15 MB', () => {
    expect(checkImageFile(file('image/jpeg', MAX_SOURCE_BYTES + 1))).toBe('The image is larger than 15 MB.')
  })
})

describe('fitWithin', () => {
  it('scales wide images down to the max width, keeping the ratio', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(3333, 1000, 1600)).toEqual({ width: 1600, height: 480 })
  })

  it('never upscales', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(1600, 900, 1600)).toEqual({ width: 1600, height: 900 })
  })

  it('keeps at least 1 px of height for extreme panoramas', () => {
    expect(fitWithin(100_000, 10, 1600)).toEqual({ width: 1600, height: 1 })
  })
})

describe('newMediaPath', () => {
  it('builds a fresh uuid path with the extension for the type', () => {
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/
    expect(newMediaPath('courts/c1', 'image/webp')).toMatch(new RegExp(`^courts/c1/${uuid.source}\\.webp$`))
    expect(newMediaPath('banner', 'image/jpeg')).toMatch(new RegExp(`^banner/${uuid.source}\\.jpg$`))
    expect(newMediaPath('banner', 'image/png')).not.toBe(newMediaPath('banner', 'image/png'))
  })

  it('refuses types the bucket would reject', () => {
    expect(() => newMediaPath('banner', 'image/gif')).toThrow('Unsupported image type')
  })
})

describe('storageErrorMessage', () => {
  it('maps common Storage statuses to plain messages', () => {
    expect(storageErrorMessage({ message: 'new row violates row-level security policy', statusCode: '403' }))
      .toBe("You don't have permission to change venue media.")
    expect(storageErrorMessage({ message: 'The object exceeded the maximum allowed size', statusCode: '413' }))
      .toBe('The image is larger than 2 MB.')
    expect(storageErrorMessage({ message: 'mime type text/html is not supported', status: 415 }))
      .toBe('Only JPG, PNG and WEBP images can be uploaded.')
  })

  it('keeps the original message otherwise', () => {
    expect(storageErrorMessage({ message: 'Failed to fetch' })).toBe('Failed to fetch')
    expect(storageErrorMessage({ message: 'Internal error', statusCode: '500' })).toBe('Internal error')
  })
})

describe('validateBannerAlt', () => {
  it('requires text that is not only whitespace', () => {
    expect(validateBannerAlt('')).toMatch(/Describe the banner image/)
    expect(validateBannerAlt(' \t\n ')).toMatch(/Describe the banner image/)
  })

  it('allows up to 200 characters after trimming', () => {
    expect(validateBannerAlt(`  ${'a'.repeat(200)}  `)).toBeNull()
    expect(validateBannerAlt('a'.repeat(201))).toBe('Use at most 200 characters.')
  })
})
