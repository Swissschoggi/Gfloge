import { useState, useEffect } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ThemeToggle } from './ThemeToggle'
import {
  IconBoard,
  IconCollapse,
  IconExplore,
  IconExpand,
  IconLogbook,
  IconMore,
  IconPlus,
  IconSettings,
  IconStats,
} from './icons'
import { api } from '../api/client'
import type { MePayload, UserPreferences } from '@gfloge/shared'

// Primary destinations (UX_ARCHITECTURE §1.1); grouped so the sidebar reads
// like an application menu, not a table of contents.
const NAV_GROUPS = [
  { id: 'ops', label: 'Ops', items: [
    { to: '/', label: 'Board', icon: IconBoard, end: true },
    { to: '/explore', label: 'Explore', icon: IconExplore, end: false },
    { to: '/stats', label: 'Stats', icon: IconStats, end: false },
  ] },
  { id: 'personal', label: 'Personal', items: [
    { to: '/logbook', label: 'Logbook', icon: IconLogbook, end: false },
    { to: '/travel-risk', label: 'Travel risk', icon: IconExplore, end: false },
  ] },
  { id: 'system', label: 'System', items: [
    { to: '/settings', label: 'Settings', icon: IconSettings, end: false },
  ] },
] as const

// Mobile bottom tabs (UX_ARCHITECTURE §1.2). Add is a centered accent action,
// not a destination tab; More hosts Stats and Settings at narrow widths.
const MOBILE_TABS = [
  { to: '/', label: 'Board', icon: IconBoard, end: true },
  { to: '/logbook', label: 'Logbook', icon: IconLogbook, end: false },
  { to: '/explore', label: 'Explore', icon: IconExplore, end: false },
  { to: '/more', label: 'More', icon: IconMore, end: true },
] as const

const SECTION_TITLES: Array<[string, string]> = [
  ['/flight', 'Flight'],
  ['/logbook', 'Logbook'],
  ['/trips', 'Trips'],
  ['/explore', 'Explore'],
  ['/stats', 'Stats'],
  ['/settings', 'Settings'],
  ['/add', 'Add flight'],
  ['/travel-risk', 'Travel risk'],
  ['/more', 'More'],
]

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false)
  const [viewsDesktop, setViewsDesktop] = useState(
    () => typeof window === 'undefined' || window.matchMedia('(min-width: 1024px)').matches
  )
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)')
    const apply = () => setViewsDesktop(media.matches)
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [])
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

  const { pathname } = useLocation()
  const rail = collapsed || !viewsDesktop
  useEffect(() => {
    document.getElementById('main')?.focus({ preventScroll: true })
  }, [pathname])
  const sectionTitle = SECTION_TITLES.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? 'Board'
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<{ me: MePayload | null; error?: unknown }>('/api/v1/me') })
  const preferences = useQuery({
    queryKey: ['preferences'],
    queryFn: () => api.get<{ preferences: UserPreferences }>('/api/v1/me/preferences'),
    enabled: !!me.data?.me,
    staleTime: 30_000,
  })
  const displayName = me.data?.me?.displayName

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
    <div className="shell" data-rail={rail ? 'true' : undefined}>
      {!online && <div role="status" className="offline-banner">You are offline. Showing saved data; changes will sync when reconnected.</div>}
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <nav className={`sidebar${rail ? ' sidebar--rail' : ''}`} aria-label="Primary">
        <div className="sidebar__head">
          <Link to="/" className="sidebar__brand">
            <span className="sidebar__brand-mark">G</span>
            <span className="sidebar__brand-rest">floge</span>
            <span className="sidebar__brand-dot" aria-hidden="true" />
          </Link>
          {viewsDesktop || collapsed ? (
            <button
              type="button"
              className="sidebar__collapse"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={() => setCollapsed((r) => !r)}
            >
              {collapsed ? <IconExpand /> : <IconCollapse />}
            </button>
          ) : null}
        </div>

        <div className="sidebar__nav">
          {NAV_GROUPS.map((group) => (
            <ul className="sidebar__list" key={group.id} aria-label={group.label}>
              <li className="navgroup" aria-hidden="true">
                {group.label}
              </li>
              {group.items.map(({ to, label, icon: Icon, end }) => (
                <li key={to}>
                  <NavLink to={to} end={end} className="navitem" aria-label={rail ? label : undefined}>
                    <Icon className="navitem__icon" />
                    <span className="navitem__label sidebar__label">{label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          ))}
        </div>

        <div className="sidebar__foot">
          {displayName ? (
            <>
              <div className="sidebar__account">
                <span className="sidebar__avatar" aria-hidden="true">{displayName.slice(0, 1).toUpperCase()}</span>
                <span className="sidebar__user sidebar__label">{displayName}</span>
                <button type="button" className="sidebar__signout sidebar__label" onClick={() => signOut.mutate()}>
                  Sign out
                </button>
              </div>
            </>
          ) : null}
        </div>
      </nav>

      <div className="shell__content">
        <header className="topbar">
          <span className="topbar__title">{sectionTitle}</span>
          <div className="topbar__actions">
            <ThemeToggle />
          </div>
        </header>

        <main id="main" className="main" tabIndex={-1}>
          <div className="main__inner">
            <Outlet />
          </div>
        </main>
      </div>

      <nav className="bottomtabs" aria-label="Mobile primary">
        {MOBILE_TABS.slice(0, 2).map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className="bottomtabs__item">
            <Icon />
            <span className="bottomtabs__label">{label}</span>
          </NavLink>
        ))}
        <NavLink to="/add" className="bottomtabs__add" aria-label="Add flight">
          <IconPlus />
        </NavLink>
        {MOBILE_TABS.slice(2).map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className="bottomtabs__item">
            <Icon />
            <span className="bottomtabs__label">{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
