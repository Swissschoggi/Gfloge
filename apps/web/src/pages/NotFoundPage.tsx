import { Link } from 'react-router'
import { PagePlaceholder } from '../components/PagePlaceholder'

export function NotFoundPage() {
  return (
    <PagePlaceholder title="Page not found" spec="404" variant="missing">
      <p className="page__meta">There's no page at this address.</p>
      <Link to="/" className="btn" style={{ marginTop: 'var(--space-m)' }}>
        Go to the Board
      </Link>
    </PagePlaceholder>
  )
}
