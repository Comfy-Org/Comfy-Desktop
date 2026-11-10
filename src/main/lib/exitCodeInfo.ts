import type { CrashKind } from '../../types/ipc'

const NTSTATUS_KINDS: ReadonlyMap<number, CrashKind> = new Map([
  [0xc0000005, 'access-violation'],
  [0xc000001d, 'illegal-instruction'],
  [0xc0000409, 'stack-buffer-overrun'],
  [0xc0000374, 'heap-corruption']
])

export interface DecodedExitCode {
  code: number
  hex: string
  kind: CrashKind
}

function toUint32(code: number): number | null {
  if (!Number.isInteger(code)) return null
  if (code < 0) return code < -0x80000000 ? null : code >>> 0
  return code <= 0xffffffff ? code : null
}

function isNtstatusFailure(code: number): boolean {
  return code >= 0xc0000000 && code <= 0xc0ffffff
}

export function decodeExitCode(code: number | null | undefined): DecodedExitCode | null {
  if (code == null) return null
  const unsigned = toUint32(code)
  if (unsigned == null || !isNtstatusFailure(unsigned)) return null
  const hex = '0x' + unsigned.toString(16).toUpperCase().padStart(8, '0')
  return { code: unsigned, hex, kind: NTSTATUS_KINDS.get(unsigned) ?? 'unknown' }
}
