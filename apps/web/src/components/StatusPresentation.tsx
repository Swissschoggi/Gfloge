// Status and data-condition presentation components (two dimension model).
import type { DataCondition, FlightStatus } from '@gfloge/shared'

const STATUS_LABELS: Record<FlightStatus, string> = {
  scheduled: 'Scheduled',
  boarding: 'Boarding',
  enroute: 'En route',
  arrived: 'Arrived',
  cancelled: 'Cancelled',
  diverted: 'Diverted',
  unknown: 'No data',
}

const STATUS_INK: Record<FlightStatus, string> = {
  scheduled: 'var(--st-sched-ink)',
  boarding: 'var(--st-board-ink)',
  enroute: 'var(--st-enrt-ink)',
  arrived: 'var(--st-done-ink)',
  cancelled: 'var(--st-cancel-ink)',
  diverted: 'var(--st-divert-ink)',
  unknown: 'var(--ink-3)',
}

const STATUS_PATHS: Record<FlightStatus, string> = {
  scheduled: 'M12 6v6l4 2',
  boarding: 'M5 8h14M5 12h14M5 16h10',
  enroute: 'M4 17l8-12 8 12M12 5v14',
  arrived: 'M5 13l4 4 10-10',
  cancelled: 'M6 6l12 12M18 6L6 18',
  diverted: 'M4 12h6l4-6 4 6h2',
  unknown: 'M12 8v4M12 16h.01',
}

export function StatusBadge({ status }: { status: FlightStatus }) {
  return (
    <span className="statusbadge" style={{ color: STATUS_INK[status], borderColor: 'var(--line)' }}>
      <svg aria-hidden="true" className="statusbadge__glyph" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d={STATUS_PATHS[status]} />
      </svg>
      {STATUS_LABELS[status]}
    </span>
  )
}

const CONDITION_LABELS: Record<DataCondition, string> = {
  fresh: 'Live',
  stale: 'Stale',
  partial: 'Partial',
  unavailable: 'No feed',
  offline: 'Offline',
}

/** Data-condition chip: distinct from operational status, textual first. */
export function ConditionChip({ condition, timestamp }: { condition: DataCondition; timestamp?: string | null }) {
  if (condition === 'fresh') return null
  const detail =
    condition === 'stale' && timestamp
      ? `${CONDITION_LABELS.stale} · updated ${new Date(timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
      : CONDITION_LABELS[condition]
  return (
    <span className="conditionchip conditionchip--warn" title={detail}>
      {detail}
    </span>
  )
}

export function statusLabel(status: FlightStatus): string {
  return STATUS_LABELS[status]
}
