// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ChildProcessModule from 'child_process'

/** The Windows port and start-time lookups, with `execFile` faked: each command answers from
 *  `fake.answers`, keyed by the program it runs. */
type Answer = { err?: { code?: string; killed?: boolean; signal?: string }; stdout?: string }
const fake = vi.hoisted(() => ({
  answers: {} as Record<string, Answer>,
  calls: [] as Array<{ cmd: string; args: string[] }>
}))
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcessModule>()
  return {
    ...actual,
    execFile: (
      cmd: string,
      args: string[],
      _opts: unknown,
      cb: (err: unknown, stdout: string) => void
    ) => {
      fake.calls.push({ cmd, args })
      const a = fake.answers[cmd] ?? { err: { code: 'ENOENT' } }
      setImmediate(() => cb(a.err ? Object.assign(new Error('x'), a.err) : null, a.stdout ?? ''))
    }
  }
})

import { holderStartToken, parseNetstatListeners } from './processIdentity'
import { findPidsByPort, killPid } from './process'

const realPlatform = process.platform

// `netstat -ano` rows; only the state word differs between UI languages.
const netstat = (state: string): string =>
  [
    '',
    'Active Connections',
    '',
    '  Proto  Local Address          Foreign Address        State           PID',
    `  TCP    0.0.0.0:135            0.0.0.0:0              ${state}       1012`,
    `  TCP    0.0.0.0:8188           0.0.0.0:0              ${state}       9084`,
    `  TCP    0.0.0.0:18188          0.0.0.0:0              ${state}       4242`,
    '  TCP    127.0.0.1:8188         127.0.0.1:50211        ESTABLISHED     9084',
    '  TCP    127.0.0.1:50211        127.0.0.1:8188         ESTABLISHED     5000',
    `  TCP    [::]:8188              [::]:0                 ${state}       9090`,
    '  UDP    0.0.0.0:8188           *:*                                    1412',
    ''
  ].join('\r\n')

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'win32' })
  fake.answers = {}
  fake.calls = []
})
afterEach(() => {
  Object.defineProperty(process, 'platform', { value: realPlatform })
})

describe('parseNetstatListeners', () => {
  it.each(['LISTENING', 'ABHÖREN', 'ÉCOUTE', 'ESCUCHANDO', 'NASŁUCHIWANIE', '侦听'])(
    'finds the IPv4 and IPv6 listeners whatever the state word (%s)',
    (state) => {
      expect(parseNetstatListeners(netstat(state), 8188).sort()).toEqual([9084, 9090])
    }
  )

  it('ignores connections to or from the port, UDP, and ports that merely end in it', () => {
    const rows = netstat('LISTENING')
      .split('\r\n')
      .filter((l) => !/TCP\s+\S+:8188\s+\S+:0\s/.test(l))
      .join('\r\n')
    expect(parseNetstatListeners(rows, 8188)).toEqual([])
  })
})

describe('findPidsByPort on Windows', () => {
  it('reads localised netstat, every protocol, without PowerShell', async () => {
    fake.answers.netstat = { stdout: netstat('ABHÖREN') }
    expect((await findPidsByPort(8188)).sort()).toEqual([9084, 9090])
    expect(fake.calls).toEqual([{ cmd: 'netstat', args: ['-ano'] }])
  })

  it('names nobody when netstat cannot run', async () => {
    fake.answers.netstat = { err: { code: 'ENOENT' } }
    expect(await findPidsByPort(8188)).toEqual([])
  })
})

describe('holderStartToken on Windows', () => {
  it('reads the exact creation FILETIME from Get-Process, not CIM', async () => {
    fake.answers.powershell = { stdout: '134358000923463901\r\n' }
    expect(await holderStartToken(9084)).toBe('134358000923463901')
    const script = fake.calls[0]!.args.join(' ')
    expect(script).toContain('Get-Process -Id 9084')
    expect(script).toContain('ToFileTimeUtc()')
    expect(script).not.toContain('Cim')
  })

  it('is null for a process that is gone, an unreadable answer, or no PowerShell', async () => {
    fake.answers.powershell = { stdout: '\r\n' }
    expect(await holderStartToken(9084)).toBeNull()
    fake.answers.powershell = { stdout: 'Access is denied.' }
    expect(await holderStartToken(9084)).toBeNull()
    fake.answers.powershell = { err: { code: 'ENOENT' } }
    expect(await holderStartToken(9084)).toBeNull()
    expect(await holderStartToken(0)).toBeNull()
  })
})

describe('killPid on Windows', () => {
  it('kills the one pid, not its tree (no /T)', async () => {
    fake.answers.taskkill = { stdout: '' }
    // Gone at once: nothing runs at this pid.
    expect(await killPid(2_147_480_000)).toBe(true)
    expect(fake.calls.find((c) => c.cmd === 'taskkill')!.args).toEqual(['/F', '/PID', '2147480000'])
  })

  it('says a process that would not exit did not', async () => {
    fake.answers.taskkill = { stdout: '' }
    // Still in the process table: not a zombie either.
    fake.answers.powershell = { stdout: `${process.ppid} 1 134358000923463901\r\n` }
    // taskkill is faked, so this (live) parent never exits.
    expect(await killPid(process.ppid)).toBe(false)
  }, 20_000)
})
