/**
 * Audit the Microsoft Visual C++ runtime DLLs on Windows.
 *
 * A `0xC0000005` (access violation) crash on launch is frequently a Python
 * C-extension (torch, numpy, onnxruntime, …) failing because the VC++ runtime
 * it links against is missing or outdated. The installer pre-installs the
 * redistributable, but that can still go wrong after the fact:
 *   - the user declined the elevation prompt (installer's "Ignore" path),
 *   - a later Windows change removed/downgraded the runtime,
 *   - the install is portable / user-managed and skipped the NSIS installer,
 *   - the redist registry key says "installed" while the DLLs are gone.
 *
 * The installer's registry-version check can't see those cases, so this audit
 * looks at the actual files in `System32`. We check the three DLLs modern
 * ComfyUI wheels need — note `vcruntime140_1.dll` ships only with the VS2015+
 * redist, so an old 2015-era runtime passes a `vcruntime140.dll` presence
 * check yet still can't load torch.
 *
 * Returns the names of the missing DLLs (empty when all present, or on any
 * non-Windows platform where the check doesn't apply).
 */
import fs from 'fs'
import path from 'path'

/** DLLs a current ComfyUI Python environment needs at import time. */
const REQUIRED_VC_DLLS = ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll'] as const

export function auditVcRuntime(): string[] {
  if (process.platform !== 'win32') return []
  const system32 = path.join(process.env.SYSTEMROOT || 'C:\\Windows', 'System32')
  const missing: string[] = []
  for (const dll of REQUIRED_VC_DLLS) {
    try {
      if (!fs.existsSync(path.join(system32, dll))) missing.push(dll)
    } catch {
      // Treat an unreadable System32 as inconclusive rather than missing — we
      // don't want to falsely blame the runtime when we simply can't look.
    }
  }
  return missing
}
