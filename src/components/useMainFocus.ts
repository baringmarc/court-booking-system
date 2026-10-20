import { useEffect, useRef, type MouseEvent } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Keyboard and screen reader focus for a layout's <main> (T8.5). After a client-side page change,
 * focus moves to <main> so the new page is read from the top instead of staying on a nav link or
 * falling back to <body>. Also powers the "Skip to main content" link, which focuses <main>
 * without touching the URL hash (guest links keep their token there).
 */
export function useMainFocus() {
  const mainRef = useRef<HTMLElement>(null)
  const { pathname } = useLocation()
  const previous = useRef(pathname)

  useEffect(() => {
    if (previous.current === pathname) return
    previous.current = pathname
    const main = mainRef.current
    if (main && !main.contains(document.activeElement)) main.focus({ preventScroll: true })
  }, [pathname])

  function skipToMain(event: MouseEvent) {
    event.preventDefault()
    mainRef.current?.focus()
  }

  return { mainRef, skipToMain }
}
