import { describe, it, expect } from 'vitest'
import { isDisplayableLabel } from './snapshots'

describe('isDisplayableLabel', () => {
  it('shows a user-supplied label', () => {
    expect(isDisplayableLabel('Restore did not complete')).toBe(true)
    expect(isDisplayableLabel('before my risky experiment')).toBe(true)
  })

  it('has nothing to show for an unlabelled snapshot', () => {
    expect(isDisplayableLabel(null)).toBe(false)
    expect(isDisplayableLabel(undefined)).toBe(false)
    expect(isDisplayableLabel('')).toBe(false)
  })

  // Older builds wrote these into `label` as internal sentinels. Rendering one
  // as a snapshot's name would replace the useful version pill with jargon.
  it.each(['before-update', 'after-update', 'after-restore'])(
    'suppresses the legacy sentinel %s',
    (label) => {
      expect(isDisplayableLabel(label)).toBe(false)
    }
  )
})
