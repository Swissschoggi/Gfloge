// Gfloge icon set: 24px grid, 1.5px stroke, geometric (per VISUAL_IDENTITY §5).
// Stroke uses currentColor; every usage must provide an accessible name.

type IconProps = {
  className?: string
  size?: number
}

function base(props: IconProps) {
  return {
    width: props.size ?? 24,
    height: props.size ?? 24,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    className: props.className,
  } as const
}

export function IconBoard(props: IconProps) {
  return (
    <svg {...base(props)}>
      {/* board: departure signal, compass needle trending upward */}
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5 13 13l-4.5 2.5L11 11z" />
    </svg>
  )
}

export function IconLogbook(props: IconProps) {
  return (
    <svg {...base(props)}>
      {/* logbook: bound record */}
      <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v16H7.5A2.5 2.5 0 0 0 5 21z" />
      <path d="M5 18.5A2.5 2.5 0 0 1 7.5 16H19" />
      <path d="M9 7h6" />
    </svg>
  )
}

export function IconExplore(props: IconProps) {
  return (
    <svg {...base(props)}>
      {/* explore: globe with route tick */}
      <circle cx="12" cy="12" r="9" />
      <path d="M3.5 12h17" />
      <path d="M12 3.2c2.6 2.4 3.9 5.4 3.9 8.8S14.6 18.4 12 20.8C9.4 18.4 8.1 15.4 8.1 12S9.4 5.6 12 3.2z" />
    </svg>
  )
}

export function IconStats(props: IconProps) {
  return (
    <svg {...base(props)}>
      {/* stats: distance bars, tabular readout */}
      <path d="M4 20V14" />
      <path d="M9.5 20V8" />
      <path d="M15 20v-4.5" />
      <path d="M20.5 20V5" />
    </svg>
  )
}

export function IconSettings(props: IconProps) {
  return (
    <svg {...base(props)}>
      {/* settings: instrument sliders */}
      <path d="M5 7h9" />
      <path d="M18 7h1" />
      <path d="M5 12h1" />
      <path d="M10 12h9" />
      <path d="M5 17h7" />
      <path d="M16 17h3" />
      <circle cx="15.5" cy="7" r="1.8" />
      <circle cx="8.5" cy="12" r="1.8" />
      <circle cx="13.5" cy="17" r="1.8" />
    </svg>
  )
}

export function IconPlus(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 5.5v13" />
      <path d="M5.5 12h13" />
    </svg>
  )
}

export function IconMore(props: IconProps) {
  return (
    <svg {...base(props)}>
      {/* more: dots column of the timetable */}
      <circle cx="12" cy="5.5" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="12" cy="18.5" r="1.4" />
    </svg>
  )
}

export function IconChevron(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9.5 6.5 15 12l-5.5 5.5" />
    </svg>
  )
}

export function IconSun(props: IconProps) {
  return (
    <svg {...base(props)}>
      {/* to broad daylight */}
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 3v2.1M12 18.9V21M3 12h2.1M18.9 12H21M5.8 5.8l1.5 1.5M16.7 16.7l1.5 1.5M18.2 5.8l-1.5 1.5M7.3 16.7l-1.5 1.5" />
    </svg>
  )
}

export function IconMoon(props: IconProps) {
  return (
    <svg {...base(props)}>
      {/* to night ops */}
      <path d="M19.5 13.7A7.7 7.7 0 0 1 10.3 4.5a7.7 7.7 0 1 0 9.2 9.2z" />
    </svg>
  )
}

export function IconCollapse(props: IconProps) {
  return (
    <svg {...base(props)}>
      {/* collapse sidebar to rail */}
      <path d="M4 5.5h13" />
      <path d="M4 18.5h13" />
      <path d="M6.5 12h13" />
      <path d="M17 9.5 19.5 12 17 14.5" />
    </svg>
  )
}

export function IconExpand(props: IconProps) {
  return (
    <svg {...base(props)}>
      {/* expand rail to sidebar */}
      <path d="M7 5.5h13" />
      <path d="M7 18.5h13" />
      <path d="M9.5 12h13" />
      <path d="M7 9.5 4.5 12 7 14.5" />
    </svg>
  )
}

export function IconPlane(props: IconProps) {
  return (
    <svg {...base(props)} fill="currentColor" stroke="none">
      <path d="M21 15.5v-1.6l-7.6-4.8V4a1.4 1.4 0 0 0-2.8 0v5.1L3 13.9v1.6l7.6-2.3V18l-2 1.5V21l3.4-1 3.4 1v-1.5l-2-1.5v-4.8z" />
    </svg>
  )
}

export function IconTrips(props: IconProps) {
  return (
    <svg {...base(props)}>
      {/* trips: two stops joined by a path */}
      <circle cx="6" cy="18" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <path d="M8.2 18H14a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h5.8" />
    </svg>
  )
}

export function IconRisk(props: IconProps) {
  return (
    <svg {...base(props)}>
      {/* travel risk: shield with exclamation */}
      <path d="M12 3 5 6v5.5c0 4.2 2.9 7.4 7 9.5 4.1-2.1 7-5.3 7-9.5V6z" />
      <path d="M12 8.5v4M12 15.8h.01" />
    </svg>
  )
}

export function IconUpload(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 16V4M7.5 8.5 12 4l4.5 4.5M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15" />
    </svg>
  )
}

export function IconSignOut(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H10M15 8l4 4-4 4M19 12H9" />
    </svg>
  )
}
