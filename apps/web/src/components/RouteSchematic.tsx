// RouteSchematic: restrained aviation graphic for empty states (EmptyState
// contract in COMPONENT_SPECIFICATION.md §1.10). Tokens only, aria-hidden,
// no fabricated data: generic DEP/ARR labels instead of invented airports.

type RouteSchematicProps = {
  variant?: 'route' | 'interrupted'
}

export function RouteSchematic({ variant = 'route' }: RouteSchematicProps) {
  return (
    <svg className="schematic" viewBox="0 0 420 84" aria-hidden="true">
      {variant === 'route' ? (
        // Unflown arc: origin to destination, still ahead of you.
        <path className="schematic__arc" d="M 22 58 Q 210 12 398 58" />
      ) : (
        // Interrupted arc: the route stops where this address does.
        <>
          <path className="schematic__arc" d="M 22 58 Q 130 24 190 34" />
          <path className="schematic__arc schematic__arc--faded" d="M 250 44 Q 330 52 398 58" />
        </>
      )}
      <circle className="schematic__depart" cx="22" cy="58" r="7" />
      <circle className="schematic__arrive" cx="398" cy="58" r="5.5" />
      <text className="schematic__label" x="22" y="76" textAnchor="middle">
        DEP
      </text>
      <text className="schematic__label" x="398" y="76" textAnchor="middle">
        ARR
      </text>
    </svg>
  )
}
