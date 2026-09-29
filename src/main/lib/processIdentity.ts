import { execFile } from 'child_process'
import fs from 'fs'

/**
 * Process identity that survives pid reuse: a pid plus an opaque start-time token. Two
 * observations of the same pid name the same process only when their tokens are equal, so a
 * pid the OS has handed to something else never passes for the process a record was written
 * about. Tokens are compared, never parsed: each platform's format is only meaningful to that
 * platform's reader below.
 *
 * - Linux: `/proc/<pid>/stat` start ticks, prefixed with the kernel boot id so a reboot can't
 *   reproduce a token. No subprocess.
 * - macOS: `ps -o lstart=` (one-second resolution; a pid recycled within the same second is not
 *   a realistic case).
 * - Windows: `Win32_Process.CreationDate` as a FILETIME. The same field feeds the process-tree
 *   snapshot, so a kill can re-verify the root in the snapshot it already takes.
 */

/** How long one OS query may run. The Windows path is PowerShell, which is slow to start. */
const PROBE_TIMEOUT_MS = 15_000

/** Whether `pid` is a running process (EPERM counts: it exists, it just isn't ours). A zombie
 *  still answers here; start-time reads treat zombies as gone. */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function run(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { windowsHide: true, timeout: PROBE_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout) => resolve(err ? null : stdout)
    )
  })
}

function powershell(command: string): Promise<string | null> {
  return run('powershell', ['-NoProfile', '-NonInteractive', '-Command', command])
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

/** Start-time token from a `/proc/<pid>/stat` line, or null for a zombie or unparseable line.
 *  The command name (field 2) may itself contain spaces and parentheses, so fields are counted
 *  from the LAST `)`. */
export function parseLinuxStat(stat: string, bootId: string): string | null {
  const close = stat.lastIndexOf(')')
  if (close < 0) return null
  const fields = stat
    .slice(close + 1)
    .trim()
    .split(/\s+/)
  // fields[0] is field 3 (state); starttime is field 22.
  const state = fields[0]
  const startTicks = fields[19]
  if (!state || state === 'Z' || state === 'X' || !startTicks || !/^\d+$/.test(startTicks)) {
    return null
  }
  return `${bootId}:${startTicks}`
}

/** `ps -o pid=,stat=,lstart=` output → pid → token. Zombies are omitted. */
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
  /** FILETIME (100ns ticks since 1601, UTC) as a decimal string; '' when unreadable. */
  created: string
}

/** Lines of `<pid> <ppid> <created>` → rows. */
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

/**
 * Start-time tokens for `pids`. A pid missing from the result is dead, a zombie, or could not
 * be read — callers must treat all three as "cannot prove it is the recorded process". Returns
 * null only when the probe itself could not run (distinct from "every pid is gone").
 */
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
      } catch {
        // gone
      }
    }
    return out
  }
  if (process.platform === 'win32') {
    const rows = await winRows(want.map((p) => `ProcessId=${p}`).join(' OR '))
    if (!rows) return null
    for (const row of rows) if (row.created) out.set(row.pid, row.created)
    return out
  }
  const stdout = await run('ps', ['-o', 'pid=,stat=,lstart=', '-p', want.join(',')])
  // `ps` exits 1 when none of the pids exist; that is an answer, not a failed probe.
  if (stdout == null) {
    return want.some(isPidAlive) ? null : out
  }
  for (const [pid, token] of parseDarwinPs(stdout)) if (want.includes(pid)) out.set(pid, token)
  return out
}

let selfStartTime: Promise<string | null> | null = null
/** This Desktop's own start-time token, read once. */
export function ownStartTime(): Promise<string | null> {
  if (!selfStartTime) {
    selfStartTime = readStartTimes([process.pid]).then((m) => m?.get(process.pid) ?? null)
  }
  return selfStartTime
}

/**
 * Descendants of `root` (root included) from a process-table snapshot. A row only counts as a
 * child when it was created no earlier than its parent: Windows keeps a dead parent's pid in
 * `ParentProcessId`, so without the ordering check an unrelated older process whose parent pid
 * was later recycled as `root` would join the tree.
 */
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

/** Windows only: the root's start token and its process tree, from one snapshot. Null when the
 *  snapshot could not be taken. */
export async function snapshotWindowsTree(
  root: number
): Promise<{ rootCreated: string | null; pids: number[] } | null> {
  const rows = await winRows()
  if (!rows) return null
  const rootRow = rows.find((r) => r.pid === root)
  if (!rootRow) return { rootCreated: null, pids: [] }
  return { rootCreated: rootRow.created || null, pids: descendantsOf(rows, root) }
}

/** Command lines of `pid` and (Windows) of its parent. On Windows the venv `python.exe` is a
 *  launcher: the listening interpreter is its child, whose command line names only the base
 *  interpreter and a relative `main.py`, so the install path is visible on the parent. */
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

/** Process group id from a `/proc/<pid>/stat` line (field 5), or null. */
export function parseLinuxStatPgid(stat: string): number | null {
  const close = stat.lastIndexOf(')')
  if (close < 0) return null
  const pgid = stat
    .slice(close + 1)
    .trim()
    .split(/\s+/)[2]
  return pgid && /^\d+$/.test(pgid) ? Number(pgid) : null
}

/**
 * POSIX: the live members of process group `pgid`, excluding its leader. Desktop spawns
 * ComfyUI as a session and group leader, so when ComfyUI itself exits, anything still in its
 * group is a descendant that outlived it — for example a subprocess that inherited ComfyUI's
 * database lock. Always empty on Windows, which has no process groups.
 */
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
      } catch {
        // exited mid-scan
      }
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

/** POSIX: the process group `pid` belongs to; null on Windows or when unreadable. */
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

/**
 * POSIX: whether process group `pgid` (leader included) has a member that is not a zombie.
 * `kill(-pgid, 0)` also answers for a group of unreaped zombies, which hold no files, locks or
 * ports; this tells the two apart. Asked only when a kill's wait runs out.
 */
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
  // Unanswerable counts as alive: this may only turn "timed out" into "gone" on evidence.
  if (stdout == null) return true
  return stdout.split('\n').some((line) => {
    const m = /^\s*(\d+)\s+(\S+)/.exec(line)
    return !!m && Number(m[1]) === pgid && !m[2]!.startsWith('Z')
  })
}

/** Linux kernel clock ticks per second for `/proc/<pid>/stat` start times (USER_HZ, 100 on every
 *  mainstream architecture). */
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

/**
 * Wall-clock start (epoch ms) of a start-time token from `readStartTimes`, for reporting only;
 * proofs compare tokens, never these. Null when the token cannot be converted.
 */
export function startTokenToEpochMs(
  token: string,
  platform: NodeJS.Platform = process.platform,
  linuxBootMs: number | null = platform === 'linux' ? readLinuxBootEpochMs() : null
): number | null {
  if (platform === 'win32') {
    // FILETIME: 100 ns ticks since 1601-01-01 UTC.
    if (!/^\d+$/.test(token)) return null
    return Number(BigInt(token) / 10_000n) - 11_644_473_600_000
  }
  if (platform === 'linux') {
    const ticks = /:(\d+)$/.exec(token)?.[1]
    if (!ticks || linuxBootMs === null) return null
    return linuxBootMs + (Number(ticks) * 1000) / LINUX_CLK_TCK
  }
  const ms = Date.parse(token)
  return Number.isFinite(ms) ? ms : null
}

/** A command line whose script is `main.py` (quoted or not, any directory): a ComfyUI, whoever
 *  started it. A process forked from ComfyUI keeps this command line. */
export function runsMainPy(commandLine: string): boolean {
  return /(^|[\s"'\\/])main\.py(["'\s]|$)/i.test(commandLine)
}

/** Linux: the exact argv of `pid` from `/proc/<pid>/cmdline` (NUL-separated, so paths with
 *  spaces survive). Null elsewhere, or when it cannot be read. */
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

export interface WinProcessRowWithCommand extends WinProcessRow {
  commandLine: string
}

/** Lines of `<pid>\t<ppid>\t<created>\t<command line>` → rows. The command line is last, so a
 *  tab inside it cannot shift the other fields. */
export function parseWinProcessRowsWithCommand(stdout: string): WinProcessRowWithCommand[] {
  const rows: WinProcessRowWithCommand[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^(\d+)\t(\d+)\t(\d*)\t(.*)$/.exec(line)
    if (!m) continue
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), created: m[3] ?? '', commandLine: m[4]! })
  }
  return rows
}

/** Windows only: pid, parent and creation time of every process (no command lines: lighter).
 *  Null when it could not be read (or not on Windows). */
export async function windowsProcessRows(): Promise<WinProcessRow[] | null> {
  if (process.platform !== 'win32') return null
  return winRows()
}

/** Windows only: the whole process table with parent links, creation times and command lines,
 *  from one CIM query. Null when it could not be read (or not on Windows). */
export async function windowsProcessTable(): Promise<WinProcessRowWithCommand[] | null> {
  if (process.platform !== 'win32') return null
  const stdout = await powershell(
    'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate,CommandLine | ' +
      'ForEach-Object { $c = if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { "" }; ' +
      '"$($_.ProcessId)`t$($_.ParentProcessId)`t$c`t$($_.CommandLine)" }'
  )
  return stdout == null ? null : parseWinProcessRowsWithCommand(stdout)
}
