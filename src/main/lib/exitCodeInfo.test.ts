import { describe, expect, it } from 'vitest'

import { decodeExitCode } from './exitCodeInfo'

describe('decodeExitCode', () => {
  it('decodes 0xC0000005 as an access violation', () => {
    expect(decodeExitCode(0xc0000005)).toEqual({
      code: 3221225477,
      hex: '0xC0000005',
      kind: 'access-violation',
    })
  })

  it('decodes the decimal form Node reports the same way', () => {
    // 3221225477 === 0xC0000005 — the value users actually see in the UI.
    expect(decodeExitCode(3221225477)).toEqual({
      code: 3221225477,
      hex: '0xC0000005',
      kind: 'access-violation',
    })
  })

  it('normalizes a signed int32 form to the same unsigned code', () => {
    // -1073741819 === 0xC0000005 as a signed 32-bit int; some wrappers report
    // exit codes that way.
    expect(decodeExitCode(-1073741819)).toEqual({
      code: 3221225477,
      hex: '0xC0000005',
      kind: 'access-violation',
    })
  })

  it('returns null for the signed force-kill sentinel (-1)', () => {
    // -1 === 0xFFFFFFFF unsigned, the TerminateProcess sentinel — not a fault.
    expect(decodeExitCode(-1)).toBeNull()
  })

  it('decodes other known native faults', () => {
    expect(decodeExitCode(0xc000001d)?.kind).toBe('illegal-instruction')
    expect(decodeExitCode(0xc0000409)?.kind).toBe('stack-buffer-overrun')
    expect(decodeExitCode(0xc0000374)?.kind).toBe('heap-corruption')
  })

  it('labels an unmapped NTSTATUS failure code as unknown but still gives hex', () => {
    expect(decodeExitCode(0xc0000017)).toEqual({
      code: 0xc0000017,
      hex: '0xC0000017',
      kind: 'unknown',
    })
  })

  it('returns null for plain application exits and signals', () => {
    expect(decodeExitCode(0)).toBeNull()
    expect(decodeExitCode(1)).toBeNull()
    expect(decodeExitCode(137)).toBeNull()
    expect(decodeExitCode(null)).toBeNull()
    expect(decodeExitCode(undefined)).toBeNull()
  })

  it('returns null for the Windows TerminateProcess sentinel (0xFFFFFFFF)', () => {
    // Force-kill reports 4294967295, which is outside the NTSTATUS fault band —
    // don't mislabel a deliberate kill as a native crash.
    expect(decodeExitCode(4294967295)).toBeNull()
  })
})
