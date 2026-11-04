import { useEffect } from 'react'
import { Link } from 'react-router'
import { IconChevron, IconRisk, IconSettings, IconStats, IconTrips, IconUpload } from '../components/icons'

// The mobile overflow menu: everything that doesn't fit the tab bar.
const ITEMS = [
  { to: '/trips', label: 'Trips', icon: IconTrips },
  { to: '/stats', label: 'Stats', icon: IconStats },
  { to: '/travel-risk', label: 'Travel risk', icon: IconRisk },
  { to: '/import', label: 'Import flights', icon: IconUpload },
  { to: '/settings', label: 'Settings', icon: IconSettings },
] as const

export function MorePage() {
  useEffect(() => {
    document.title = 'More · Gfloge'
  }, [])
  return (
    <article className="page">
      <h1>More</h1>
      <nav aria-label="More destinations">
        <ul className="menu">
          {ITEMS.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <Link to={to} className="menuitem">
                <Icon />
                <span>{label}</span>
                <IconChevron className="menuitem__chevron" />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </article>
  )
}
