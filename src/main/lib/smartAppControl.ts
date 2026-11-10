import { execFile } from 'child_process'
import * as os from 'os'
import * as path from 'path'

export type SmartAppControlState = 'on' | 'evaluation' | 'off' | 'not_applicable' | 'unknown'

const POLICY_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\CI\\Policy'
const STATE_VALUE = 'VerifiedAndReputablePolicyState'
const READ_TIMEOUT_MS = 1000
const SETTLE_DEADLINE_MS = READ_TIMEOUT_MS + 500
const FIRST_SAC_BUILD = 22621

const STATES: Record<number, SmartAppControlState> = { 0: 'off', 1: 'on', 2: 'evaluation' }

export function parsePolicyKeyListing(stdout: string): SmartAppControlState {
  const line = stdout.split(/\r?\n/).find((l) => l.trim().split(/\s+/)[0] === STATE_VALUE)
  if (!line) return 'not_applicable'
  const hex = /REG_DWORD\s+0x([0-9a-f]+)/i.exec(line)?.[1]
  return (hex !== undefined && STATES[parseInt(hex, 16)]) || 'unknown'
}

export function readSmartAppControlState(): Promise<SmartAppControlState> {
  if (process.platform !== 'win32') return Promise.resolve('not_applicable')
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
      clearTimeout(deadline)
      resolve('unknown')
    }
  })
}
