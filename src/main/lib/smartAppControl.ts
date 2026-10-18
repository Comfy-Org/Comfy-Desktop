/**
 * Windows Smart App Control (SAC) state, read once at boot so ops-flag release conditions can
 * target it (`sac_state`, see `telemetry.opsFlagPersonProperties`). SAC blocks unsigned
 * executables, so a rollout of an unsigned component can exclude machines where it is on.
 *
 * Windows keeps the state in `HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy`, value
 * `VerifiedAndReputablePolicyState`: 0 off, 1 on (enforcing), 2 evaluation (Windows is still
 * deciding whether to turn it on). The whole key is listed rather than the one value, because
 * reg.exe reports a missing value with the same exit code as any other failure and a localized
 * message; a listed key without the value means no SAC policy is set. Builds before Windows 11
 * 22H2 (22621), where SAC first shipped, are `not_applicable` without a read.
 */
import { execFile } from 'child_process'
import * as os from 'os'
import * as path from 'path'

export type SmartAppControlState = 'on' | 'evaluation' | 'off' | 'not_applicable' | 'unknown'

const POLICY_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\CI\\Policy'
const STATE_VALUE = 'VerifiedAndReputablePolicyState'
const READ_TIMEOUT_MS = 1000
/** `execFile`'s timeout only sends the kill; this settles the read even if the child lingers. */
const SETTLE_DEADLINE_MS = READ_TIMEOUT_MS + 500
const FIRST_SAC_BUILD = 22621

const STATES: Record<number, SmartAppControlState> = { 0: 'off', 1: 'on', 2: 'evaluation' }

/** Maps `reg query <POLICY_KEY>` output to a state. */
export function parsePolicyKeyListing(stdout: string): SmartAppControlState {
  const line = stdout.split(/\r?\n/).find((l) => l.trim().split(/\s+/)[0] === STATE_VALUE)
  if (!line) return 'not_applicable'
  const hex = /REG_DWORD\s+0x([0-9a-f]+)/i.exec(line)?.[1]
  return (hex !== undefined && STATES[parseInt(hex, 16)]) || 'unknown'
}

/** Never rejects: a failed or slow read is `unknown`, so no condition mistakes it for off. */
export function readSmartAppControlState(): Promise<SmartAppControlState> {
  if (process.platform !== 'win32') return Promise.resolve('not_applicable')
  // `os.release()` on Windows is `10.0.<build>`.
  const build = Number(os.release().split('.')[2])
  if (build < FIRST_SAC_BUILD) return Promise.resolve('not_applicable')
  const regExe = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe')
  return new Promise((resolve) => {
    const deadline = setTimeout(() => resolve('unknown'), SETTLE_DEADLINE_MS)
    deadline.unref?.()
    try {
      execFile(
        regExe,
        ['query', POLICY_KEY],
        { timeout: READ_TIMEOUT_MS, windowsHide: true },
        (err, stdout) => {
          clearTimeout(deadline)
          resolve(err ? 'unknown' : parsePolicyKeyListing(stdout))
        }
      )
    } catch {
      // Some spawn failures throw instead of reaching the callback.
      clearTimeout(deadline)
      resolve('unknown')
    }
  })
}
