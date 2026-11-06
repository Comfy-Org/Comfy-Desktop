import { execFile, type ExecFileException } from 'child_process'

export interface LockingProcess {
  pid: number
  name: string
}

export type LockProbeFailure = 'timeout' | 'unavailable'

export type LockProbeResult =
  | { ok: true; processes: LockingProcess[] }
  | { ok: false; reason: LockProbeFailure }

const TIMEOUT_MS = 10000

export function findLockingProcesses(
  filePath: string,
  timeoutMs: number = TIMEOUT_MS
): Promise<LockProbeResult> {
  if (process.platform === 'win32') {
    return findLockingProcessesWindows(filePath, timeoutMs)
  }
  return findLockingProcessesUnix(filePath, timeoutMs)
}

const WINDOWS_PROBE_FAILED = '__RM_QUERY_FAILED__'

function classifyCommonFailure(err: ExecFileException): LockProbeFailure | null {
  if (typeof err.code === 'string') return 'unavailable'
  if (err.killed === true || err.signal) return 'timeout'
  return null
}

function classifyUnixFailure(err: ExecFileException): LockProbeFailure | null {
  const common = classifyCommonFailure(err)
  if (common) return common
  return err.code === 1 ? null : 'unavailable'
}

function classifyWindowsFailure(err: ExecFileException): LockProbeFailure {
  return classifyCommonFailure(err) ?? 'unavailable'
}

function findLockingProcessesWindows(
  filePath: string,
  timeoutMs: number
): Promise<LockProbeResult> {
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
      { timeout: timeoutMs, killSignal: 'SIGKILL', windowsHide: true },
      (err, stdout) => {
        const failure = err ? classifyWindowsFailure(err) : null
        if (failure === 'timeout') return resolve({ ok: false, reason: failure })
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

function findLockingProcessesUnix(filePath: string, timeoutMs: number): Promise<LockProbeResult> {
  return new Promise((resolve) => {
    execFile(
      'lsof',
      ['-F', 'pc', '--', filePath],
      { timeout: timeoutMs, killSignal: 'SIGKILL', windowsHide: true },
      (err, stdout) => {
        const failure = err ? classifyUnixFailure(err) : null
        if (failure === 'timeout') return resolve({ ok: false, reason: failure })
        const processes = parseLsofOutput(stdout)
        if (failure && processes.length === 0) return resolve({ ok: false, reason: failure })
        resolve({ ok: true, processes })
      }
    )
  })
}

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
