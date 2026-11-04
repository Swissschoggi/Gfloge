import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Brand } from './Brand'
import { ThemeToggle } from './ThemeToggle'
import {
  IconBoard,
  IconExplore,
  IconLogbook,
  IconMore,
  IconPlus,
  IconSettings,
  IconSignOut,
  IconUpload,
} from './icons'
import { api } from '../api/client'
import type { MePayload, UserPreferences } from '@gfloge/shared'

// Desktop: one floating pill holds every destination. Mobile: the same
// destinations fold into a floating tab bar, with the rest under "More".
const NAV_LINKS = [
  { to: '/', label: 'Board', end: true },
  { to: '/logbook', label: 'Logbook', end: false },
  { to: '/trips', label: 'Trips', end: false },
  { to: '/explore', label: 'Explore', end: false },
  { to: '/stats', label: 'Stats', end: false },
  { to: '/travel-risk', label: 'Travel risk', end: false },
] as const

const TABS_LEFT = [
  { to: '/', label: 'Board', icon: IconBoard, end: true },
  { to: '/logbook', label: 'Logbook', icon: IconLogbook, end: false },
] as const
const TABS_RIGHT = [
  { to: '/explore', label: 'Explore', icon: IconExplore, end: false },
  { to: '/more', label: 'More', icon: IconMore, end: true },
] as const

export function AppShell() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  // Route change: close menu, move focus to the page for screen readers.
  useEffect(() => {
    setMenuOpen(false)
    document.getElementById('main')?.focus({ preventScroll: true })
  }, [pathname])

  // Dismiss account menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<{ me: MePayload | null; error?: unknown }>('/api/v1/me') })
  const preferences = useQuery({
    queryKey: ['preferences'],
    queryFn: () => api.get<{ preferences: UserPreferences }>('/api/v1/me/preferences'),
    enabled: !!me.data?.me,
    staleTime: 30_000,
  })
  const displayName = me.data?.me?.displayName
  const email = me.data?.me?.email

  useEffect(() => {
    const prefs = preferences.data?.preferences
    if (!prefs) return
    localStorage.setItem('gfloge-timezone-display', prefs.timezoneDisplay)
    localStorage.setItem('gfloge-units', prefs.units)
  }, [preferences.data])

  const signOut = useMutation({
    mutationFn: () => api.post('/api/v1/auth/logout'),
    onSuccess: () => {
      queryClient.removeQueries()
      navigate('/signin', { replace: true })
    },
  })

  return (
    <div className="shell">
      {!online && (
        <div role="status" className="announce">
          You’re offline. Showing saved data; changes sync when you reconnect.
        </div>
      )}
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="navwrap">
        <nav className="navpill" aria-label="Primary">
          <Brand />

          <ul className="navpill__links">
            {NAV_LINKS.map(({ to, label, end }) => (
              <li key={to}>
                <NavLink to={to} end={end} className="navlink">
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>

          <div className="navpill__end">
            <ThemeToggle />
            <Link to="/add" className="btn btn--sm navpill__add">
              <IconPlus size={18} /> Add flight
            </Link>
            {displayName ? (
              <div className="acct" ref={menuRef}>
                <button
                  type="button"
                  className="acct__trigger"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label={`Account menu for ${displayName}`}
                  onClick={() => setMenuOpen((open) => !open)}
                >
                  {displayName.slice(0, 1).toUpperCase()}
                </button>
                {menuOpen && (
                  <div className="acct__menu" role="menu">
                    <div className="acct__who">
                      <strong>{displayName}</strong>
                      {email ? <span>{email}</span> : null}
                    </div>
                    <div className="acct__sep" />
                    <Link to="/import" role="menuitem" className="acct__item">
                      <IconUpload size={20} /> Import flights
                    </Link>
                    <Link to="/settings" role="menuitem" className="acct__item">
                      <IconSettings size={20} /> Settings
                    </Link>
                    <div className="acct__sep" />
                    <button type="button" role="menuitem" className="acct__item" onClick={() => signOut.mutate()}>
                      <IconSignOut size={20} /> Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </nav>
      </header>

      <main id="main" className="main" tabIndex={-1}>
        <div className="main__inner">
          <Outlet />
        </div>
      </main>

      <nav className="tabbar" aria-label="Mobile primary">
        {TABS_LEFT.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className="tabbar__item">
            <Icon size={22} />
            <span className="tabbar__label">{label}</span>
          </NavLink>
        ))}
        <NavLink to="/add" className="tabbar__add" aria-label="Add flight">
          <IconPlus size={26} />
        </NavLink>
        {TABS_RIGHT.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className="tabbar__item">
            <Icon size={22} />
            <span className="tabbar__label">{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
