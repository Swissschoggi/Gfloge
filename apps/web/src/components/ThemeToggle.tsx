import { useCallback, useEffect, useState } from 'react'
import { IconMoon, IconSun } from './icons'

type Theme = 'day' | 'night'

const STORAGE_KEY = 'gfloge-theme'

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(
    () => (document.documentElement.dataset.theme as Theme | undefined) ?? 'day'
  )

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      if (localStorage.getItem(STORAGE_KEY)) return // explicit choice wins
      const next: Theme = media.matches ? 'night' : 'day'
      setTheme(next)
      document.documentElement.dataset.theme = next
    }
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [])

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'day' ? 'night' : 'day'
      document.documentElement.dataset.theme = next
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        /* storage unavailable: session-only choice */
      }
      return next
    })
  }, [])

  return { theme, toggle }
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const nextLabel = theme === 'day' ? 'Deep Chart theme' : 'Chart Room theme'
  return (
    <button type="button" className="topbar__button" onClick={toggle} aria-label={`Switch to ${nextLabel}`}>
      {theme === 'day' ? <IconMoon /> : <IconSun />}
    </button>
  )
}
