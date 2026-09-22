import { execFile, type ExecFileException } from 'child_process'

export interface LockingProcess {
  pid: number
  name: string
}

/** Why a probe never produced a list of holders. */
export type LockProbeFailure =
  /** The platform tool was still running when `TIMEOUT_MS` killed it. */
  | 'timeout'
  /** The platform tool could not be run at all (not installed, spawn failed). */
  | 'unavailable'

/**
 * Outcome of one lock probe.
 *
 * `ok: true` means the holder set was determined, so an empty `processes`
 * genuinely means nothing holds the file. `ok: false` means the probe never
 * found out, which is NOT the same thing and must not be reported to the user
 * as "nothing is using it".
 */
export type LockProbeResult =
  | { ok: true; processes: LockingProcess[] }
  | { ok: false; reason: LockProbeFailure }

const TIMEOUT_MS = 10000

/**
 * Processes holding a lock on `filePath`.
 *
 * Still best-effort - it can fail to get an answer - but it reports that
 * failure instead of folding it into an empty list.
 */
export function findLockingProcesses(filePath: string): Promise<LockProbeResult> {
  if (process.platform === 'win32') {
    return findLockingProcessesWindows(filePath)
  }
  return findLockingProcessesUnix(filePath)
}

/**
 * Separate "the tool answered, and the answer is empty" from "we never got an
 * answer". Returns `null` for the former.
 *
 * The distinction is not cosmetic: `lsof` exits 1 when it simply matches
 * nothing, so the ordinary unlocked-file path arrives here as an error.
 * Treating every error as a failure would make every successful delete claim
 * the lock check broke. Only a kill (the `TIMEOUT_MS` cap, or an outside
 * signal) or a spawn failure - which surfaces as a string `code` such as
 * `ENOENT`, never an exit status - means we genuinely did not find out.
 */
function classifyProbeFailure(err: ExecFileException): LockProbeFailure | null {
  if (err.killed === true || err.signal) return 'timeout'
  if (typeof err.code === 'string') return 'unavailable'
  return null
}

// Windows: query the built-in Restart Manager API via inline C# in PowerShell.
function findLockingProcessesWindows(filePath: string): Promise<LockProbeResult> {
  // Escape single quotes for PowerShell string embedding.
  const escaped = filePath.replace(/'/g, "''")
  const script = `
$code = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class RmUtil {
    [StructLayout(LayoutKind.Sequential)] public struct RM_UNIQUE_PROCESS {
        public int dwProcessId;
        public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime;
    }
    const int RmRebootReasonNone = 0;
    const int CCH_RM_MAX_APP_NAME = 255;
    const int CCH_RM_MAX_SVC_NAME = 63;
    public enum RM_APP_TYPE { RmUnknownApp=0, RmMainWindow=1, RmOtherWindow=2, RmService=3, RmExplorer=4, RmConsole=5, RmCritical=1000 }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct RM_PROCESS_INFO {
        public RM_UNIQUE_PROCESS Process;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=CCH_RM_MAX_APP_NAME+1)] public string strAppName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=CCH_RM_MAX_SVC_NAME+1)] public string strServiceShortName;
        public RM_APP_TYPE ApplicationType;
        public uint AppStatus;
        public uint TSSessionId;
        [MarshalAs(UnmanagedType.Bool)] public bool bRestartable;
    }
    [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)] static extern int RmStartSession(out uint h, int flags, string key);
    [DllImport("rstrtmgr.dll")] static extern int RmEndSession(uint h);
    [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)] static extern int RmRegisterResources(uint h, uint nFiles, string[] rgFiles, uint nApps, RM_UNIQUE_PROCESS[] rgApps, uint nSvcs, string[] rgSvcs);
    [DllImport("rstrtmgr.dll")] static extern int RmGetList(uint h, out uint nProcInfoNeeded, ref uint nProcInfo, [In,Out] RM_PROCESS_INFO[] rgAffectedApps, ref uint lpdwRebootReasons);

    public static string Query(string path) {
        uint handle;
        if (RmStartSession(out handle, 0, Guid.NewGuid().ToString()) != 0) return "";
        try {
            if (RmRegisterResources(handle, 1, new[]{path}, 0, null, 0, null) != 0) return "";
            uint needed = 0, count = 0, reasons = 0;
            int rc = RmGetList(handle, out needed, ref count, null, ref reasons);
            if (rc == 234 && needed > 0) { count = needed; }
            else if (rc != 0) return "";
            else return "";
            var info = new RM_PROCESS_INFO[count];
            rc = RmGetList(handle, out needed, ref count, info, ref reasons);
            if (rc != 0) return "";
            var results = new List<string>();
            for (int i = 0; i < count; i++) {
                try {
                    var p = Process.GetProcessById(info[i].Process.dwProcessId);
                    results.Add(p.Id + "\\t" + p.ProcessName);
                } catch {
                    results.Add(info[i].Process.dwProcessId + "\\t" + info[i].strAppName);
                }
            }
            return string.Join("\\n", results);
        } finally { RmEndSession(handle); }
    }
}
'@
Add-Type -TypeDefinition $code
[RmUtil]::Query('${escaped}')
`
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: TIMEOUT_MS, windowsHide: true },
      (err, stdout) => {
        if (err) {
          const failure = classifyProbeFailure(err)
          if (failure) return resolve({ ok: false, reason: failure })
        }
        const results: LockingProcess[] = []
        for (const line of stdout.trim().split('\n')) {
          const parts = line.trim().split('\t')
          if (parts.length >= 2) {
            const pid = parseInt(parts[0]!, 10)
            const name = parts[1]!
            if (pid > 0 && name) results.push({ pid, name })
          }
        }
        resolve({ ok: true, processes: results })
      }
    )
  })
}

// Linux/macOS: `lsof -F pc` gives machine-readable "p<pid>" / "c<command>"
// line pairs, avoiding the column-shift parsing issues of the default format.
function findLockingProcessesUnix(filePath: string): Promise<LockProbeResult> {
  return new Promise((resolve) => {
    execFile(
      'lsof',
      ['-F', 'pc', '--', filePath],
      { timeout: TIMEOUT_MS, windowsHide: true },
      (err, stdout) => {
        if (err) {
          const failure = classifyProbeFailure(err)
          // A timeout kill can leave a partial scan in `stdout`. Reporting
          // those names as the answer would just swap one half-truth for
          // another, so drop them and say the probe did not finish.
          if (failure) return resolve({ ok: false, reason: failure })
        }
        const results: LockingProcess[] = []
        const seen = new Set<number>()
        let currentPid = 0
        for (const line of stdout.trim().split('\n')) {
          if (line.startsWith('p')) {
            currentPid = parseInt(line.slice(1), 10)
          } else if (line.startsWith('c') && currentPid > 0) {
            if (!seen.has(currentPid)) {
              seen.add(currentPid)
              results.push({ pid: currentPid, name: line.slice(1) })
            }
          }
        }
        resolve({ ok: true, processes: results })
      }
    )
  })
}
