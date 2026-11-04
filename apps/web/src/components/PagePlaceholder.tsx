import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { RouteSchematic } from './RouteSchematic'

type PagePlaceholderProps = {
  title: string
  /** Reference into SCREEN_SPECIFICATIONS.md, printed honestly, e.g. "S-3". */
  spec: string
  /** 'planned' shows the first-use schematic; 'missing' (404/more) shows the interrupted arc. */
  variant?: 'planned' | 'missing'
  children?: ReactNode
}

// PHASE 1 FOUNDATION: page shells only.
// These render the route skeleton (title, landmarks, focus) as aviation-
// grounded empty states without fabricated screen content. Real screens
// replace them as specified in docs/design/SCREEN_SPECIFICATIONS.md.
export function PagePlaceholder({ title, spec, variant = 'planned', children }: PagePlaceholderProps) {
  void spec
  void variant
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    document.title = `${title} · Gfloge`
    headingRef.current?.focus()
  }, [title])

  return (
    <article className="page">
      {variant === 'planned' ? <RouteSchematic variant="route" /> : <RouteSchematic variant="interrupted" />}
      <h1 ref={headingRef} tabIndex={-1}>
        {title}
      </h1>
      {children ?? (
        <p className="page__meta">
          This section is coming soon.
        </p>
      )}
    </article>
  )
}
