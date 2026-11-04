import { createContext, useCallback, useContext } from 'react'

type UpdateDirty = (key: string, dirty: boolean) => void

export const SettingsDirtyContext = createContext<UpdateDirty>(() => {})

export function useSettingsDirty(key: string) {
  const update = useContext(SettingsDirtyContext)
  return useCallback((dirty: boolean) => update(key, dirty), [key, update])
}
