import fs from 'fs'
import path from 'path'
import type { PathRoot } from '../../shared/piiScrub'

/**
 * The directories whose paths error text may carry, relative to a token, for
 * one installation: its ComfyUI checkout as `<comfyui>` and the install base as
 * `<install>`, which holds the Desktop-managed Python environment. Each root is
 * also listed in its resolved form, so a symlinked install matches whichever
 * form the traceback printed. Every other path is redacted by `scrubPaths`.
 */
export function installPathRoots(installPath: string | null | undefined): PathRoot[] {
  if (!installPath) return []
  const roots: PathRoot[] = []
  for (const [dir, token] of [
    [path.join(installPath, 'ComfyUI'), '<comfyui>'],
    [installPath, '<install>']
  ] as const) {
    roots.push({ path: dir, token })
    try {
      const real = fs.realpathSync.native(dir)
      if (real !== dir) roots.push({ path: real, token })
    } catch {
      // Absent or unreadable: the literal form above still applies.
    }
  }
  return roots
}
