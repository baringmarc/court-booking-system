import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useBlocker } from 'react-router-dom'
import { SettingsDirtyContext } from './settingsDraft'

export function SettingsCategoryPage({ title, children }: { title: string; children: ReactNode }) {
  const [dirtyFields, setDirtyFields] = useState<Set<string>>(() => new Set())
  const setDirty = useCallback((key: string, dirty: boolean) => setDirtyFields((current) => {
    const next = new Set(current)
    if (dirty) next.add(key)
    else next.delete(key)
    return next
  }), [])
  const dirty = dirtyFields.size > 0
  const blocker = useBlocker(dirty)
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [dirty])
  return <SettingsDirtyContext.Provider value={setDirty}>
    <section className="page settings-category">
      <div className="page-head"><div><Link className="back-link" to="/admin/settings">← Back to Settings</Link><h1>{title}</h1></div></div>
      {dirty && <p className="muted settings-unsaved" role="status">You have unsaved changes.</p>}
      {children}
    </section>
    {blocker.state === 'blocked' && <div className="modal-backdrop" role="presentation">
      <section className="dialog card stack" role="dialog" aria-modal="true" aria-labelledby="settings-unsaved-title" onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); blocker.reset?.() }
        if (event.key !== 'Tab') return
        const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button')
        const first = buttons[0]
        const last = buttons[buttons.length - 1]
        if (event.shiftKey && (event.target === first || !event.currentTarget.contains(event.target as Node))) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && event.target === last) {
          event.preventDefault()
          first?.focus()
        }
      }}>
        <h2 id="settings-unsaved-title">Unsaved changes</h2>
        <p>Leave this page without saving your changes?</p>
        <div className="form-actions">
          <button type="button" className="btn btn-outline" autoFocus onClick={() => blocker.reset?.()}>Stay</button>
          <button type="button" className="btn" onClick={() => blocker.proceed?.()}>Leave</button>
        </div>
      </section>
    </div>}
  </SettingsDirtyContext.Provider>
}
