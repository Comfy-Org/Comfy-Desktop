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
 * `ok: true` means the probe ran to completion and named who it found, so an
 * empty `processes` means it looked and named nobody. That is as strong as the
 * platform tools allow: `lsof` reports an unreadable `/proc` entry or a denied
 * permission with the same exit status it uses for a clean no-match, so a
 * determined-empty answer is "nothing it could see holds the file".
 *
 * `ok: false` means the probe never got that far, which is a different thing
 * entirely and must not be reported to the user as "nothing is using it".
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
 * Printed by the Windows script when a Restart Manager call fails. The script
 * reports "nobody holds this file" as empty output, so without a distinct
 * token a failed API call is indistinguishable from a clean answer - and the
 * process still exits 0, which puts it out of reach of any exit-code check.
 */
const WINDOWS_PROBE_FAILED = '__RM_QUERY_FAILED__'

/**
 * Separate "the tool answered, and the answer is empty" from "we never got an
 * answer". Returns `null` for the former.
 *
 * A kill - the `TIMEOUT_MS` cap, or an outside signal - and a spawn failure,
 * which surfaces as a string `code` such as `ENOENT` rather than an exit
 * status, mean the same thing on both platforms. What an *exit status* means
 * does not, so each platform decides that for itself below.
 */
function classifyCommonFailure(err: ExecFileException): LockProbeFailure | null {
  // Order matters. A `maxBuffer` overflow also arrives `killed: true`, so
  // checking the kill first would file it under the 10s cap and put a wrong
  // reason in the caller's log. Our own timeout kill carries no string `code`,
  // so letting that test win first costs it nothing. A signal from outside is
  // genuinely indistinguishable from our own and stays 'timeout'.
  if (typeof err.code === 'string') return 'unavailable'
  if (err.killed === true || err.signal) return 'timeout'
  return null
}

/**
 * `lsof` exits 1 when it simply matches nothing, so that one status is a real
 * answer and the ordinary unlocked-file path arrives here as an error.
 * Treating every error as a failure would make every successful delete claim
 * the lock check broke. Any *other* status is unexplained, and guessing that
 * it means "empty" is the very conflation this module exists to remove.
 */
function classifyUnixFailure(err: ExecFileException): LockProbeFailure | null {
  const common = classifyCommonFailure(err)
  if (common) return common
  return err.code === 1 ? null : 'unavailable'
}

/**
 * PowerShell has no "found nothing" exit status - a probe that ran reports
 * emptiness in its output and exits 0 - so unlike `lsof` every nonzero exit
 * here is a script that did not complete, whatever its code.
 */
function classifyWindowsFailure(err: ExecFileException): LockProbeFailure {
  return classifyCommonFailure(err) ?? 'unavailable'
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

    // Empty output means "nobody holds it"; FAILED means the query broke. The
    // two used to be the same empty string, which made a broken probe look
    // like a clean file.
    const string FAILED = "${WINDOWS_PROBE_FAILED}";
    public static string Query(string path) {
        uint handle;
        if (RmStartSession(out handle, 0, Guid.NewGuid().ToString()) != 0) return FAILED;
        try {
            if (RmRegisterResources(handle, 1, new[]{path}, 0, null, 0, null) != 0) return FAILED;
            uint needed = 0, count = 0, reasons = 0;
            int rc = RmGetList(handle, out needed, ref count, null, ref reasons);
            if (rc == 234 && needed > 0) { count = needed; }
            else if (rc != 0) return FAILED;
            else return "";
            var info = new RM_PROCESS_INFO[count];
            rc = RmGetList(handle, out needed, ref count, info, ref reasons);
            if (rc != 0) return FAILED;
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
      { timeout: TIMEOUT_MS, killSignal: 'SIGKILL', windowsHide: true },
      (err, stdout) => {
        const failure = err ? classifyWindowsFailure(err) : null
        // A timeout kill can leave a partial scan behind. Reporting those
        // names as the answer would swap one half-truth for another.
        if (failure === 'timeout') return resolve({ ok: false, reason: failure })
        // The script ran and told us its query broke - a case no exit status
        // reaches, since PowerShell itself succeeded.
        if (stdout.trim() === WINDOWS_PROBE_FAILED) {
          return resolve({ ok: false, reason: 'unavailable' })
        }
        const processes = parseRestartManagerOutput(stdout)
        if (failure && processes.length === 0) return resolve({ ok: false, reason: failure })
        resolve({ ok: true, processes })
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
      { timeout: TIMEOUT_MS, killSignal: 'SIGKILL', windowsHide: true },
      (err, stdout) => {
        const failure = err ? classifyUnixFailure(err) : null
        // A timeout kill can leave a partial scan in `stdout`. Reporting those
        // names as the answer would just swap one half-truth for another, so
        // drop them and say the probe did not finish.
        if (failure === 'timeout') return resolve({ ok: false, reason: failure })
        const processes = parseLsofOutput(stdout)
        // An unexplained exit that still named holders did find something real;
        // only one with nothing to show means we never got an answer.
        if (failure && processes.length === 0) return resolve({ ok: false, reason: failure })
        resolve({ ok: true, processes })
      }
    )
  })
}

/** `pid\tname` rows, one per holder. */
function parseRestartManagerOutput(stdout: string): LockingProcess[] {
  const results: LockingProcess[] = []
  for (const line of stdout.trim().split('\n')) {
    const parts = line.trim().split('\t')
    if (parts.length >= 2) {
      const pid = parseInt(parts[0]!, 10)
      const name = parts[1]!
      if (pid > 0 && name) results.push({ pid, name })
    }
  }
  return results
}

/** `lsof -F pc` output: "p<pid>" / "c<command>" line pairs, deduplicated by
 *  pid so a process holding the file through several fds is named once. */
function parseLsofOutput(stdout: string): LockingProcess[] {
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
  return results
}
