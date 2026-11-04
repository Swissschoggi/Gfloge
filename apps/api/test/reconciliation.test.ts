import test from 'node:test'
import assert from 'node:assert/strict'
import { canOverwrite, mergeField } from '../src/reconciliation.js'

test('reconciliation: manual override protected', () => {
  const existing = { value: 'A', source: 'manual' as const, updatedAt: '2026-01-01', manualOverride: true }
  const d = canOverwrite(existing, 'provider')
  assert.equal(d.apply, false)
})

test('reconciliation: provider enriches missing', () => {
  const d = canOverwrite(null, 'provider')
  assert.equal(d.apply, true)
})

test('reconciliation: identical value no change', () => {
  const existing = { value: 'A', source: 'provider' as const, updatedAt: '2026-01-01', manualOverride: false }
  const r = mergeField(existing, { value: 'A', source: 'provider', updatedAt: '2026-01-02' })
  assert.equal(r.changed, false)
})
