import { describe, expect, it, vi } from 'vitest'
import { clearStoredMedia, replaceStoredMedia } from './mediaReplace'

function steps(overrides: Partial<Parameters<typeof replaceStoredMedia<string>>[0]> = {}) {
  const calls: string[] = []
  const s = {
    oldPath: 'courts/c/old.webp' as string | null,
    upload: vi.fn(async () => { calls.push('upload'); return 'courts/c/new.webp' }),
    save: vi.fn(async (path: string) => { calls.push(`save ${path}`); return 'row' }),
    remove: vi.fn(async (path: string) => { calls.push(`remove ${path}`) }),
    ...overrides,
  }
  return { s, calls }
}

describe('replaceStoredMedia', () => {
  it('uploads, saves the new path, then removes the old file', async () => {
    const { s, calls } = steps()
    await expect(replaceStoredMedia(s)).resolves.toBe('row')
    expect(calls).toEqual(['upload', 'save courts/c/new.webp', 'remove courts/c/old.webp'])
  })

  it('removes nothing when there was no old file', async () => {
    const { s, calls } = steps({ oldPath: null })
    await replaceStoredMedia(s)
    expect(calls).toEqual(['upload', 'save courts/c/new.webp'])
  })

  it('does not save or remove anything when the upload fails', async () => {
    const { s } = steps({ upload: vi.fn(async () => { throw new Error('mime type text/html is not supported') }) })
    await expect(replaceStoredMedia(s)).rejects.toThrow('mime type')
    expect(s.save).not.toHaveBeenCalled()
    expect(s.remove).not.toHaveBeenCalled()
  })

  it('removes the new file and keeps the old one when saving fails', async () => {
    const { s } = steps({ save: vi.fn(async () => { throw new Error('permission denied') }) })
    await expect(replaceStoredMedia(s)).rejects.toThrow('permission denied')
    expect(s.remove).toHaveBeenCalledTimes(1)
    expect(s.remove).toHaveBeenCalledWith('courts/c/new.webp')
  })

  it('reports the save error even if cleaning up the new file fails', async () => {
    const { s } = steps({
      save: vi.fn(async () => { throw new Error('permission denied') }),
      remove: vi.fn(async () => { throw new Error('not deleted') }),
    })
    await expect(replaceStoredMedia(s)).rejects.toThrow('permission denied')
  })

  it('still succeeds when removing the old file fails (best effort)', async () => {
    const { s } = steps({ remove: vi.fn(async () => { throw new Error('not deleted') }) })
    await expect(replaceStoredMedia(s)).resolves.toBe('row')
  })
})

describe('clearStoredMedia', () => {
  it('clears the column before removing the file', async () => {
    const calls: string[] = []
    await clearStoredMedia({
      oldPath: 'banner/old.webp',
      save: async () => { calls.push('save'); return 'row' },
      remove: async (p) => { calls.push(`remove ${p}`) },
    })
    expect(calls).toEqual(['save', 'remove banner/old.webp'])
  })

  it('keeps the file when clearing the column fails', async () => {
    const remove = vi.fn(async () => {})
    await expect(clearStoredMedia({ oldPath: 'banner/old.webp', save: async () => { throw new Error('denied') }, remove }))
      .rejects.toThrow('denied')
    expect(remove).not.toHaveBeenCalled()
  })

  it('succeeds when removing the file fails (best effort)', async () => {
    await expect(clearStoredMedia({
      oldPath: 'banner/old.webp',
      save: async () => 'row',
      remove: async () => { throw new Error('not deleted') },
    })).resolves.toBe('row')
  })
})
