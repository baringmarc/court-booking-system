// Ordering for replacing a stored image (RESEARCH M6, "Replacing and removing images"). The upload and the
// row update can't share a transaction, so a failure may leave an unreferenced file, never a row that
// points at a missing one.

type ReplaceSteps<T> = {
  /** Path the old image is stored at, if any. */
  oldPath: string | null
  upload: () => Promise<string>
  save: (newPath: string) => Promise<T>
  remove: (path: string) => Promise<void>
}

export async function replaceStoredMedia<T>({ oldPath, upload, save, remove }: ReplaceSteps<T>): Promise<T> {
  const newPath = await upload()
  let saved: T
  try {
    saved = await save(newPath)
  } catch (error) {
    await remove(newPath).catch(() => {})
    throw error
  }
  // Best effort: a failure leaves an orphan, which the RESEARCH M6 query lists for manual cleanup.
  if (oldPath && oldPath !== newPath) await remove(oldPath).catch(() => {})
  return saved
}

type ClearSteps<T> = { oldPath: string; save: () => Promise<T>; remove: (path: string) => Promise<void> }

/** Clears the column first, then removes the file (best effort). */
export async function clearStoredMedia<T>({ oldPath, save, remove }: ClearSteps<T>): Promise<T> {
  const saved = await save()
  await remove(oldPath).catch(() => {})
  return saved
}
