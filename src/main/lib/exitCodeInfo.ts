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

/** A recognised native-crash flavour. `unknown` covers any other NTSTATUS
 *  failure code we decode the hex for but have no specific guidance on. */
export type CrashKind =
  | 'access-violation'
  | 'illegal-instruction'
  | 'stack-buffer-overrun'
  | 'heap-corruption'
  | 'unknown'

/** Known NTSTATUS failure codes mapped to a crash flavour. Values are the
 *  unsigned 32-bit codes Node surfaces (same as `0xC000....`). */
const NTSTATUS_KINDS: ReadonlyMap<number, CrashKind> = new Map([
  [0xc0000005, 'access-violation'],
  [0xc000001d, 'illegal-instruction'],
  [0xc0000409, 'stack-buffer-overrun'],
  [0xc0000374, 'heap-corruption'],
])

export interface DecodedExitCode {
  /** Hex form of the code, e.g. `'0xC0000005'`. */
  hex: string
  /** Recognised crash flavour, or `'unknown'` for an unmapped NTSTATUS code. */
  kind: CrashKind
}

/** True for the standard NTSTATUS error band (`0xC0000000`–`0xC0FFFFFF`),
 *  where the documented `STATUS_*` crash codes live (access violation, illegal
 *  instruction, stack/heap corruption, …). Deliberately excludes the
 *  `0xFFFFFFFF` TerminateProcess sentinel so a force-kill isn't mislabelled as
 *  a native fault. */
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
  if (code == null || !Number.isInteger(code) || !isNtstatusFailure(code)) return null
  const hex = '0x' + code.toString(16).toUpperCase().padStart(8, '0')
  return { hex, kind: NTSTATUS_KINDS.get(code) ?? 'unknown' }
}
