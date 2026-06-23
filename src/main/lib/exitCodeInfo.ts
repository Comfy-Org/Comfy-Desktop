/**
 * Decode the cryptic exit codes Windows hands back when ComfyUI's Python
 * process is killed by a native fault.
 *
 * Node reports those faults as a large unsigned exit code (e.g.
 * `3221225477`) with no signal, which is meaningless to a user. Those values
 * are NTSTATUS codes: the high nibble `0xC` marks a failure and the rest
 * identifies the fault. The most common one we see is `0xC0000005`
 * (STATUS_ACCESS_VIOLATION) — a segfault inside a C-extension DLL, almost
 * always a broken/missing native dependency rather than a ComfyUI bug.
 *
 * This module stays pure (no fs / no platform calls) so it is trivially
 * testable; the platform-specific follow-up (auditing the VC++ runtime) lives
 * in `vcRuntimeAudit.ts`.
 */

import type { CrashKind } from '../../types/ipc'

/** Known NTSTATUS failure codes mapped to a crash flavour. Values are the
 *  unsigned 32-bit codes Node surfaces (same as `0xC000....`). */
const NTSTATUS_KINDS: ReadonlyMap<number, CrashKind> = new Map([
  [0xc0000005, 'access-violation'],
  [0xc000001d, 'illegal-instruction'],
  [0xc0000409, 'stack-buffer-overrun'],
  [0xc0000374, 'heap-corruption'],
])

export interface DecodedExitCode {
  /** Normalised unsigned 32-bit form of the code (e.g. `3221225477`). Always
   *  matches `hex`, even when the input arrived as a signed int32. */
  code: number
  /** Hex form of the code, e.g. `'0xC0000005'`. */
  hex: string
  /** Recognised crash flavour, or `'unknown'` for an unmapped NTSTATUS code. */
  kind: CrashKind
}

/**
 * Normalise an exit code to its unsigned 32-bit value, or `null` if it isn't a
 * valid 32-bit integer. Windows native faults can reach us either unsigned
 * (`3221225477`, the usual `ChildProcess` path) or as a signed int32
 * (`-1073741819`) depending on the wrapper, so fold both to the same value.
 */
function toUint32(code: number): number | null {
  if (!Number.isInteger(code)) return null
  if (code < 0) return code < -0x80000000 ? null : code >>> 0
  return code <= 0xffffffff ? code : null
}

/** True for the conservative NTSTATUS failure band (`0xC0000000`–`0xC0FFFFFF`),
 *  where the common process crash / loader statuses live (access violation,
 *  illegal instruction, stack/heap corruption, DLL-not-found, …). Deliberately
 *  excludes the `0xFFFFFFFF` TerminateProcess sentinel so a force-kill isn't
 *  mislabelled as a native fault. Not every possible NTSTATUS error lives in
 *  this band, but the relevant native-crash ones do. */
function isNtstatusFailure(code: number): boolean {
  return code >= 0xc0000000 && code <= 0xc0ffffff
}

/**
 * Decode a process exit code into a native-crash description, or `null` when
 * the code is a plain application exit (not a Windows native fault). Only
 * NTSTATUS failure codes are decoded — a normal non-zero exit (1, 2, …) or a
 * POSIX signal carries no extra meaning here.
 */
export function decodeExitCode(code: number | null | undefined): DecodedExitCode | null {
  if (code == null) return null
  const unsigned = toUint32(code)
  if (unsigned == null || !isNtstatusFailure(unsigned)) return null
  const hex = '0x' + unsigned.toString(16).toUpperCase().padStart(8, '0')
  return { code: unsigned, hex, kind: NTSTATUS_KINDS.get(unsigned) ?? 'unknown' }
}
