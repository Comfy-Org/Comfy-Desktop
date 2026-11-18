import { execFile } from 'child_process'
import fs from 'fs'

const PROBE_TIMEOUT_MS = 15_000

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        windowsHide: true,
        timeout: PROBE_TIMEOUT_MS,
        maxBuffer: 32 * 1024 * 1024,
        ...(env ? { env } : {})
      },
      (err, stdout) => resolve(err ? null : stdout)
    )
  })
}

const PS_UTF8_PREFIX = '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); '

function powershell(command: string): Promise<string | null> {
  return run('powershell', ['-NoProfile', '-NonInteractive', '-Command', PS_UTF8_PREFIX + command])
}

function validPids(pids: readonly number[]): number[] {
  return [...new Set(pids.filter((p) => Number.isInteger(p) && p > 0))]
}

let linuxBootId: string | null | undefined
function readLinuxBootId(): string | null {
  if (linuxBootId === undefined) {
    try {
      linuxBootId = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf-8').trim() || null
    } catch {
      linuxBootId = null
    }
  }
  return linuxBootId
}

export function parseLinuxStat(stat: string, bootId: string): string | null {
  const close = stat.lastIndexOf(')')
  if (close < 0) return null
  const fields = stat
    .slice(close + 1)
    .trim()
    .split(/\s+/)
  const state = fields[0]
  const startTicks = fields[19]
  if (!state || state === 'Z' || state === 'X' || !startTicks || !/^\d+$/.test(startTicks)) {
    return null
  }
  return `${bootId}:${startTicks}`
}

export function parseDarwinPs(stdout: string): Map<number, string> {
  const out = new Map<number, string>()
  for (const line of stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line)
    if (!m) continue
    if (m[2]!.startsWith('Z')) continue
    out.set(Number(m[1]), m[3]!)
  }
  return out
}

export interface WinProcessRow {
  pid: number
  ppid: number
  created: string
}

export function parseWinProcessRows(stdout: string): WinProcessRow[] {
  const rows: WinProcessRow[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s*(\d*)\s*$/.exec(line)
    if (!m) continue
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), created: m[3] ?? '' })
  }
  return rows
}

const WIN_ROW_FORMAT =
  'ForEach-Object { $c = if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { "" }; ' +
  '"$($_.ProcessId) $($_.ParentProcessId) $c" }'

async function winRows(filter?: string): Promise<WinProcessRow[] | null> {
  const where = filter ? ` -Filter "${filter}"` : ''
  const stdout = await powershell(
    `Get-CimInstance Win32_Process${where} -Property ProcessId,ParentProcessId,CreationDate | ${WIN_ROW_FORMAT}`
  )
  return stdout == null ? null : parseWinProcessRows(stdout)
}

export async function readStartTimes(pids: readonly number[]): Promise<Map<number, string> | null> {
  const want = validPids(pids)
  const out = new Map<number, string>()
  if (want.length === 0) return out
  if (process.platform === 'linux') {
    const bootId = readLinuxBootId()
    if (!bootId) return null
    for (const pid of want) {
      try {
        const token = parseLinuxStat(fs.readFileSync(`/proc/${pid}/stat`, 'utf-8'), bootId)
        if (token) out.set(pid, token)
      } catch {}
    }
    return out
  }
  if (process.platform === 'win32') {
    const rows = await winRows(want.map((p) => `ProcessId=${p}`).join(' OR '))
    if (!rows) return null
    for (const row of rows) if (row.created) out.set(row.pid, row.created)
    return out
  }
  const stdout = await run('ps', ['-o', 'pid=,stat=,lstart=', '-p', want.join(',')], {
    ...process.env,
    TZ: 'UTC',
    LC_ALL: 'C'
  })
  if (stdout == null) {
    return want.some(isPidAlive) ? null : out
  }
  for (const [pid, token] of parseDarwinPs(stdout)) if (want.includes(pid)) out.set(pid, token)
  return out
}

let selfStartTime: Promise<string | null> | null = null
export function ownStartTime(): Promise<string | null> {
  if (!selfStartTime) {
    selfStartTime = readStartTimes([process.pid]).then((m) => m?.get(process.pid) ?? null)
  }
  return selfStartTime
}

export function descendantsOf(rows: readonly WinProcessRow[], root: number): number[] {
  const byPid = new Map(rows.map((r) => [r.pid, r]))
  const children = new Map<number, WinProcessRow[]>()
  for (const r of rows) {
    if (r.pid === r.ppid) continue
    const list = children.get(r.ppid) ?? []
    list.push(r)
    children.set(r.ppid, list)
  }
  const out: number[] = [root]
  const seen = new Set<number>([root])
  const queue = [root]
  while (queue.length > 0) {
    const parent = queue.shift()!
    const parentCreated = byPid.get(parent)?.created
    for (const child of children.get(parent) ?? []) {
      if (seen.has(child.pid)) continue
      if (parentCreated && child.created && BigInt(child.created) < BigInt(parentCreated)) continue
      seen.add(child.pid)
      out.push(child.pid)
      queue.push(child.pid)
    }
  }
  return out
}

export async function snapshotWindowsTree(
  root: number
): Promise<{ rootCreated: string | null; pids: number[] } | null> {
  const rows = await winRows()
  return rows ? treeFromRows(rows, root) : null
}

export function treeFromRows(
  rows: readonly WinProcessRow[],
  root: number
): { rootCreated: string | null; pids: number[] } {
  const rootRow = rows.find((r) => r.pid === root)
  const pids = descendantsOf(rows, root)
  return {
    rootCreated: rootRow?.created || null,
    pids: rootRow ? pids : pids.filter((p) => p !== root)
  }
}

export async function commandLinesOf(pid: number): Promise<string[]> {
  if (!Number.isInteger(pid) || pid <= 0) return []
  if (process.platform === 'win32') {
    const stdout = await powershell(
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($p) { $p.CommandLine; ` +
        `$q = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)"; ` +
        `if ($q -and $q.CreationDate -le $p.CreationDate) { $q.CommandLine } }`
    )
    return stdout == null ? [] : stdout.split(/\r?\n/).filter((l) => l.trim().length > 0)
  }
  const stdout = await run('ps', ['-p', String(pid), '-o', 'args='])
  return stdout == null || !stdout.trim() ? [] : [stdout.trim()]
}

export function parseLinuxStatPgid(stat: string): number | null {
  const close = stat.lastIndexOf(')')
  if (close < 0) return null
  const pgid = stat
    .slice(close + 1)
    .trim()
    .split(/\s+/)[2]
  return pgid && /^\d+$/.test(pgid) ? Number(pgid) : null
}

export async function groupMembers(pgid: number): Promise<number[]> {
  if (process.platform === 'win32' || !Number.isInteger(pgid) || pgid <= 0) return []
  if (process.platform === 'linux') {
    const out: number[] = []
    let entries: string[]
    try {
      entries = fs.readdirSync('/proc')
    } catch {
      return []
    }
    for (const name of entries) {
      if (!/^\d+$/.test(name) || Number(name) === pgid) continue
      try {
        if (parseLinuxStatPgid(fs.readFileSync(`/proc/${name}/stat`, 'utf-8')) === pgid) {
          out.push(Number(name))
        }
      } catch {}
    }
    return out
  }
  const stdout = await run('ps', ['-A', '-o', 'pid=,pgid='])
  if (stdout == null) return []
  const out: number[] = []
  for (const line of stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line)
    if (m && Number(m[2]) === pgid && Number(m[1]) !== pgid) out.push(Number(m[1]))
  }
  return out
}

export async function processGroupOf(pid: number): Promise<number | null> {
  if (process.platform === 'win32' || !Number.isInteger(pid) || pid <= 0) return null
  if (process.platform === 'linux') {
    try {
      return parseLinuxStatPgid(fs.readFileSync(`/proc/${pid}/stat`, 'utf-8'))
    } catch {
      return null
    }
  }
  const stdout = await run('ps', ['-o', 'pgid=', '-p', String(pid)])
  const n = stdout == null ? NaN : Number(stdout.trim())
  return Number.isInteger(n) && n > 0 ? n : null
}

export async function groupHasLiveMembers(pgid: number): Promise<boolean> {
  if (process.platform === 'win32' || !Number.isInteger(pgid) || pgid <= 0) return false
  if (process.platform === 'linux') {
    let entries: string[]
    try {
      entries = fs.readdirSync('/proc')
    } catch {
      return true
    }
    for (const name of entries) {
      if (!/^\d+$/.test(name)) continue
      let stat: string
      try {
        stat = fs.readFileSync(`/proc/${name}/stat`, 'utf-8')
      } catch {
        continue
      }
      if (parseLinuxStatPgid(stat) !== pgid) continue
      const state = stat.slice(stat.lastIndexOf(')') + 1).trim()[0]
      if (state !== 'Z' && state !== 'X') return true
    }
    return false
  }
  const stdout = await run('ps', ['-A', '-o', 'pgid=,stat='])
  if (stdout == null) return true
  return stdout.split('\n').some((line) => {
    const m = /^\s*(\d+)\s+(\S+)/.exec(line)
    return !!m && Number(m[1]) === pgid && !m[2]!.startsWith('Z')
  })
}

const LINUX_CLK_TCK = 100

let linuxBootEpochMs: number | null | undefined
function readLinuxBootEpochMs(): number | null {
  if (linuxBootEpochMs === undefined) {
    try {
      const m = /^btime\s+(\d+)$/m.exec(fs.readFileSync('/proc/stat', 'utf-8'))
      linuxBootEpochMs = m ? Number(m[1]) * 1000 : null
    } catch {
      linuxBootEpochMs = null
    }
  }
  return linuxBootEpochMs
}

export function startTokenToEpochMs(
  token: string,
  platform: NodeJS.Platform = process.platform,
  linuxBootMs: number | null = platform === 'linux' ? readLinuxBootEpochMs() : null
): number | null {
  if (platform === 'win32') {
    if (!/^\d+$/.test(token)) return null
    return Number(BigInt(token) / 10_000n) - 11_644_473_600_000
  }
  if (platform === 'linux') {
    const ticks = /:(\d+)$/.exec(token)?.[1]
    if (!ticks || linuxBootMs === null) return null
    return linuxBootMs + (Number(ticks) * 1000) / LINUX_CLK_TCK
  }
  const ms = Date.parse(`${token} UTC`)
  return Number.isFinite(ms) ? ms : null
}

export function runsMainPy(commandLine: string): boolean {
  return /(^|[\s"'\\/])main\.py(["'\s]|$)/i.test(commandLine)
}

export async function commandArgvOf(pid: number): Promise<string[] | null> {
  if (process.platform !== 'linux' || !Number.isInteger(pid) || pid <= 0) return null
  try {
    const raw = await fs.promises.readFile(`/proc/${pid}/cmdline`, 'utf-8')
    const argv = raw.split('\0')
    if (argv[argv.length - 1] === '') argv.pop()
    return argv.length > 0 ? argv : null
  } catch {
    return null
  }
}

export async function processCwdOf(pid: number): Promise<string | null> {
  if (!Number.isInteger(pid) || pid <= 0) return null
  if (process.platform === 'linux') {
    try {
      return await fs.promises.readlink(`/proc/${pid}/cwd`)
    } catch {
      return null
    }
  }
  if (process.platform !== 'darwin') return null
  const stdout = await run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'])
  const line = stdout?.split('\n').find((l) => l.startsWith('n'))
  return line ? line.slice(1) : null
}

export interface WinProcessRowWithCommand extends WinProcessRow {
  commandLine: string
}

export function parseWinProcessRowsWithCommand(stdout: string): WinProcessRowWithCommand[] {
  const rows: WinProcessRowWithCommand[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^(\d+)\t(\d+)\t(\d*)\t(.*)$/.exec(line)
    if (!m) continue
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), created: m[3] ?? '', commandLine: m[4]! })
  }
  return rows
}

export async function windowsProcessRows(): Promise<WinProcessRow[] | null> {
  if (process.platform !== 'win32') return null
  return winRows()
}

export async function windowsProcessTable(): Promise<WinProcessRowWithCommand[] | null> {
  if (process.platform !== 'win32') return null
  const stdout = await powershell(
    'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate,CommandLine | ' +
      'ForEach-Object { $c = if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { "" }; ' +
      '$cmd = if ($_.CommandLine) { $_.CommandLine -replace "[\r\n]", " " } else { "" }; ' +
      '"$($_.ProcessId)`t$($_.ParentProcessId)`t$c`t$cmd" }'
  )
  return stdout == null ? null : parseWinProcessRowsWithCommand(stdout)
}
