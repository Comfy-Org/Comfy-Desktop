import { spawn } from 'child_process'
import { describe, expect, it } from 'vitest'
import {
  descendantsOf,
  groupHasLiveMembers,
  isPidAlive,
  parseDarwinPs,
  parseLinuxStat,
  parseLinuxStatPgid,
  parseWinProcessRows,
  parseWinProcessRowsWithCommand,
  readStartTimes,
  startTokenToEpochMs
} from './processIdentity'

describe('parseLinuxStat', () => {
  // Fields after the command: state(3) ... starttime(22) is the 20th.
  const tail = (state: string, start: string): string =>
    `${state} 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 ${start} 20 21`

  it('reads the start ticks and prefixes the boot id', () => {
    expect(parseLinuxStat(`123 (python) ${tail('S', '98765')}`, 'boot-a')).toBe('boot-a:98765')
  })

  it('counts fields from the last parenthesis, so a command name cannot shift them', () => {
    expect(parseLinuxStat(`123 (evil ) S 1 (x) ${tail('R', '555')}`, 'b')).toBe('b:555')
  })

  it('treats a zombie as gone', () => {
    expect(parseLinuxStat(`123 (python) ${tail('Z', '98765')}`, 'b')).toBeNull()
  })

  it('rejects a truncated line', () => {
    expect(parseLinuxStat('123 (python) S 1 2', 'b')).toBeNull()
  })
})

describe('parseLinuxStatPgid', () => {
  it('reads field 5 past a command name with spaces and parentheses', () => {
    expect(parseLinuxStatPgid('123 (a) b) S 1 777 777 0 -1')).toBe(777)
  })
})

describe('parseDarwinPs', () => {
  it('maps pid to the lstart text and drops zombies', () => {
    const out = parseDarwinPs(
      '  501 Ss   Mon Sep 28 10:02:03 2026\n  777 Z    Mon Sep 28 10:02:04 2026\n'
    )
    expect([...out]).toEqual([[501, 'Mon Sep 28 10:02:03 2026']])
  })
})

describe('parseWinProcessRows', () => {
  it('parses pid, parent and creation time, tolerating CRLF and a missing time', () => {
    expect(parseWinProcessRows('4 0 \r\n100 4 133700000000000000\r\ngarbage\r\n')).toEqual([
      { pid: 4, ppid: 0, created: '' },
      { pid: 100, ppid: 4, created: '133700000000000000' }
    ])
  })
})

describe('descendantsOf', () => {
  it('walks the whole tree below the root', () => {
    const rows = [
      { pid: 10, ppid: 1, created: '100' },
      { pid: 11, ppid: 10, created: '110' },
      { pid: 12, ppid: 11, created: '120' },
      { pid: 99, ppid: 1, created: '105' }
    ]
    expect(descendantsOf(rows, 10).sort()).toEqual([10, 11, 12])
  })

  it('ignores a process older than the root that names it as parent (a recycled pid)', () => {
    const rows = [
      { pid: 10, ppid: 1, created: '500' },
      { pid: 20, ppid: 10, created: '100' },
      { pid: 21, ppid: 10, created: '600' }
    ]
    expect(descendantsOf(rows, 10).sort()).toEqual([10, 21])
  })
})

describe.runIf(process.platform !== 'win32')('readStartTimes (real processes)', () => {
  it('gives a stable token for a live process and none for a dead one', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      stdio: 'ignore'
    })
    try {
      const pid = child.pid!
      const first = await readStartTimes([pid, process.pid])
      const second = await readStartTimes([pid])
      expect(first?.get(pid)).toBeTruthy()
      expect(first?.get(process.pid)).toBeTruthy()
      expect(first?.get(pid)).not.toBe(first?.get(process.pid))
      expect(second?.get(pid)).toBe(first?.get(pid))
      const exited = new Promise((r) => child.once('exit', r))
      child.kill('SIGKILL')
      await exited
      expect(isPidAlive(pid)).toBe(false)
      expect((await readStartTimes([pid]))?.has(pid)).toBe(false)
    } finally {
      child.kill('SIGKILL')
    }
  })
})

describe.runIf(process.platform !== 'win32')('groupHasLiveMembers (real processes)', () => {
  it('sees a live group and stops seeing it once the group is gone', async () => {
    const leader = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      stdio: 'ignore',
      detached: true
    })
    try {
      expect(await groupHasLiveMembers(leader.pid!)).toBe(true)
      const exited = new Promise((r) => leader.once('exit', r))
      process.kill(-leader.pid!, 'SIGKILL')
      await exited
      expect(await groupHasLiveMembers(leader.pid!)).toBe(false)
    } finally {
      try {
        process.kill(-leader.pid!, 'SIGKILL')
      } catch {}
    }
  })
})

describe('startTokenToEpochMs', () => {
  it('converts a Windows FILETIME', () => {
    // 2026-09-28T17:02:03Z
    const ms = Date.UTC(2026, 8, 28, 17, 2, 3)
    const filetime = (BigInt(ms) + 11_644_473_600_000n) * 10_000n
    expect(startTokenToEpochMs(String(filetime), 'win32')).toBe(ms)
  })

  it('converts Linux start ticks against the boot time', () => {
    expect(startTokenToEpochMs('boot-id:12345', 'linux', 1_000_000)).toBe(1_000_000 + 123_450)
    expect(startTokenToEpochMs('boot-id:12345', 'linux', null)).toBeNull()
  })

  it('parses macOS lstart text, and rejects junk', () => {
    expect(startTokenToEpochMs('Mon Sep 28 10:02:03 2026', 'darwin')).toBe(
      new Date(2026, 8, 28, 10, 2, 3).getTime()
    )
    expect(startTokenToEpochMs('not a date', 'darwin')).toBeNull()
    expect(startTokenToEpochMs('abc', 'win32')).toBeNull()
  })
})

describe.runIf(process.platform === 'linux')('startTokenToEpochMs (this process)', () => {
  it('puts this process start within a second of what node reports', async () => {
    const token = (await readStartTimes([process.pid]))!.get(process.pid)!
    const expected = Date.now() - process.uptime() * 1000
    expect(Math.abs(startTokenToEpochMs(token)! - expected)).toBeLessThan(2_000)
  })
})

describe('parseWinProcessRowsWithCommand', () => {
  it('keeps the command line whole, tabs and spaces included', () => {
    expect(
      parseWinProcessRowsWithCommand(
        '200\t101\t1500\t"C:\\My Comfy\\python.exe" "main.py"\tx\r\n4\t0\t\t\r\njunk\r\n'
      )
    ).toEqual([
      {
        pid: 200,
        ppid: 101,
        created: '1500',
        commandLine: '"C:\\My Comfy\\python.exe" "main.py"\tx'
      },
      { pid: 4, ppid: 0, created: '', commandLine: '' }
    ])
  })
})
