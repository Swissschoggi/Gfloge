import { Link } from 'react-router'
import { IconPlane } from './icons'

/** Gfloge wordmark: a plane in a solid disc, in the spirit of the departure board. */
export function Brand({ to = '/', asLink = true }: { to?: string; asLink?: boolean }) {
  const inner = (
    <>
      <span className="brand__mark" aria-hidden="true">
        <IconPlane />
      </span>
      <span className="brand__name">Gfloge</span>
    </>
  )
  return asLink ? (
    <Link to={to} className="brand" aria-label="Gfloge home">
      {inner}
    </Link>
  ) : (
    <span className="brand">{inner}</span>
  )
}
