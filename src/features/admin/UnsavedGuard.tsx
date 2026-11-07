import { useEffect, type ReactNode } from 'react'
import { useBlocker } from 'react-router-dom'
import { ConfirmDialog } from './ConfirmDialog'

/**
 * Blocks in-app navigation to another page and tab close while `dirty`; render the returned dialog once. A change of
 * search params only (the Schedule page's `?tab=`, T17.31) stays on the page and keeps the draft, so it isn't blocked.
 */
export function useUnsavedGuard(dirty: boolean): ReactNode {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname)
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [dirty])
  if (blocker.state !== 'blocked') return null
  return <ConfirmDialog
    id="unsaved-changes" title="Unsaved changes" body="Leave this page without saving your changes?"
    stay="Stay" confirm="Leave" onStay={() => blocker.reset?.()} onConfirm={() => blocker.proceed?.()} />
}
