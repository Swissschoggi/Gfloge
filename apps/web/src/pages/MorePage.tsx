import { Link } from 'react-router'
import { PagePlaceholder } from '../components/PagePlaceholder'
import { IconChevron, IconSettings, IconStats } from '../components/icons'

// "More" hosts Stats and Settings on narrow widths (UX_ARCHITECTURE §1.2):
// a proper application menu, not a link list. Expands with real screens.
export function MorePage() {
  return (
    <PagePlaceholder title="More" spec="More page" variant="missing">
      <nav aria-label="More destinations">
        <ul className="menu">
          <li className="menu__label" aria-hidden="true">App</li>
          <li>
            <Link to="/stats" className="menuitem">
              <IconStats />
              <span>Stats</span>
              <IconChevron className="menuitem__chevron" />
            </Link>
          </li>
          <li>
            <Link to="/settings" className="menuitem">
              <IconSettings />
              <span>Settings</span>
              <IconChevron className="menuitem__chevron" />
            </Link>
          </li>
        </ul>
      </nav>
    </PagePlaceholder>
  )
}
