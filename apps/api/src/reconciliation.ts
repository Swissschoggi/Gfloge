// Deterministic field-level reconciliation helpers.
// Policy: manual overrides are never overwritten by provider/historical/imported data.

export type FieldSource = 'manual' | 'provider' | 'historical' | 'imported' | 'unknown'

export type FieldProvenance = {
  value: unknown
  source: FieldSource
  sourceId?: string
  updatedAt: string
  manualOverride: boolean
}

export type ReconciliationDecision = {
  apply: boolean
  reason: string
}

export function canOverwrite(existing: FieldProvenance | null, incomingSource: FieldSource): ReconciliationDecision {
  if (!existing) return { apply: true, reason: 'no existing value' }
  if (existing.manualOverride) {
    if (incomingSource === 'manual') return { apply: true, reason: 'manual update replaces manual value' }
    return { apply: false, reason: 'manual override protected' }
  }
  // historical/imported never replace newer live observations
  if (existing.source === 'provider' && (incomingSource === 'historical' || incomingSource === 'imported')) {
    return { apply: false, reason: 'live provider value takes precedence over historical/imported' }
  }
  // identical values do not need update
  return { apply: true, reason: 'incoming enrichment allowed' }
}

export function mergeField<T>(existing: FieldProvenance | null, incoming: { value: T; source: FieldSource; sourceId?: string; updatedAt: string }): { provenance: FieldProvenance; changed: boolean } {
  const decision = canOverwrite(existing, incoming.source)
  if (!decision.apply) return { provenance: existing!, changed: false }
  if (existing && JSON.stringify(existing.value) === JSON.stringify(incoming.value)) {
    return { provenance: existing, changed: false }
  }
  return {
    provenance: {
      value: incoming.value,
      source: incoming.source,
      sourceId: incoming.sourceId,
      updatedAt: incoming.updatedAt,
      manualOverride: incoming.source === 'manual',
    },
    changed: true,
  }
}
