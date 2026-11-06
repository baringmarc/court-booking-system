// T17.27: the function replies `done` only when Storage holds nothing under the venue's folders.
import { describe, expect, it } from 'vitest'
import { venueFilesLeft, type CleanupStorage } from './venueCleanup.ts'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

function storageOf(files: string[]): CleanupStorage {
  return {
    async list(bucket, folder) {
      const start = `${bucket}/${folder}/`
      const children = new Map<string, string | null>()
      for (const f of files) {
        if (!f.startsWith(start)) continue
        const [first, ...tail] = f.slice(start.length).split('/')
        children.set(first, tail.length > 0 ? null : 'id')
      }
      return { data: [...children].map(([name, id]) => ({ name, id })), error: null }
    },
    async remove() { return { error: null } },
  }
}

describe('venueFilesLeft', () => {
  it('counts nested files of the venue in both buckets and ignores other venues and buckets', async () => {
    const storage = storageOf([
      `venue-media/${A}/courts/c/p.png`, `venue-media/${A}/logo.png`, `payment-qr/${A}/q.png`,
      `venue-media/${B}/logo.png`, `payment-proofs/${A}/proof.png`,
    ])
    expect(await venueFilesLeft(storage, A)).toBe(3)
    expect(await venueFilesLeft(storage, '33333333-3333-4333-8333-333333333333')).toBe(0)
  })

  it('throws on a list error, so the reply stays pending', async () => {
    const storage: CleanupStorage = { list: async () => ({ data: null, error: { message: 'down' } }), remove: async () => ({ error: null }) }
    await expect(venueFilesLeft(storage, A)).rejects.toThrow(/down/)
  })
})
