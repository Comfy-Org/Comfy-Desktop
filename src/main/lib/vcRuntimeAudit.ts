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
 *
 * The probe is async (`fs.promises.access`) so it never blocks the Electron
 * main-process event loop, even though it only runs after a crash and only
 * touches local System32 paths.
 */
import fs from 'fs'
import path from 'path'

/** DLLs a current ComfyUI Python environment needs at import time. */
const REQUIRED_VC_DLLS: string[] = ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll']

export async function auditVcRuntime(): Promise<string[]> {
  if (process.platform !== 'win32') return []
  const system32 = path.join(process.env.SYSTEMROOT || 'C:\\Windows', 'System32')
  const results = await Promise.all(
    REQUIRED_VC_DLLS.map(async (dll) => {
      try {
        await fs.promises.access(path.join(system32, dll), fs.constants.F_OK)
        return null
      } catch (err) {
        // Only a genuine "not found" counts as missing; any other error
        // (permissions, etc.) is inconclusive, so we don't falsely blame the
        // runtime when we simply couldn't look.
        return (err as NodeJS.ErrnoException).code === 'ENOENT' ? dll : null
      }
    }),
  )
  return results.filter((dll): dll is string => dll !== null)
}
