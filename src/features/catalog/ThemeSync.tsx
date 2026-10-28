import { useEffect } from 'react'
import { applyTheme, DEFAULT_THEME, isThemePreset } from '../../lib/themes'
import { useVenueSettings } from './hooks'

/** Keeps <html data-theme> on the venue's saved preset (T11.7), for every visitor. Renders nothing. */
export function ThemeSync() {
  const theme = useVenueSettings().data?.theme
  useEffect(() => {
    if (theme !== undefined) applyTheme(isThemePreset(theme) ? theme : DEFAULT_THEME)
  }, [theme])
  return null
}
