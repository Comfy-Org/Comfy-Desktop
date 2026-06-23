import { describe, expect, it } from 'vitest'

import { auditVcRuntime } from './vcRuntimeAudit'

describe('auditVcRuntime', () => {
  it('returns an empty array on non-Windows platforms', async () => {
    if (process.platform === 'win32') return
    expect(await auditVcRuntime()).toEqual([])
  })

  it('only ever reports known VC++ runtime DLLs', async () => {
    // Deterministic regardless of host: whatever it reports must be drawn from
    // the fixed set of DLLs we check, never an arbitrary path.
    const known = new Set(['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll'])
    const missing = await auditVcRuntime()
    expect(Array.isArray(missing)).toBe(true)
    for (const dll of missing) expect(known.has(dll)).toBe(true)
  })
})
