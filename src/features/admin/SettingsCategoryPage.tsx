import { useCallback, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useUnsavedGuard } from './UnsavedGuard'
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
  const guard = useUnsavedGuard(dirty)
  return <SettingsDirtyContext.Provider value={setDirty}>
    <section className="page settings-category">
      <div className="page-head"><div><Link className="back-link" to="/admin/settings">← Back to Settings</Link><h1>{title}</h1></div></div>
      {dirty && <p className="muted settings-unsaved" role="status">You have unsaved changes.</p>}
      {children}
    </section>
    {guard}
  </SettingsDirtyContext.Provider>
}
