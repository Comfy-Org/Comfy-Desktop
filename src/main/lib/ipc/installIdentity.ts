import { allocateUniqueDir, findDuplicatePath, sanitizeDirName, uniqueName } from './shared'

export type InstallIdentity =
  | { ok: true; name: string; installPath?: string }
  | { ok: false; message: string }

export async function allocateInstallIdentity(
  baseName: string,
  installRoot?: string
): Promise<InstallIdentity> {
  const name = await uniqueName(baseName)
  if (!installRoot) return { ok: true, name }
  const installPath = allocateUniqueDir(installRoot, sanitizeDirName(name))
  const duplicate = await findDuplicatePath(installPath)
  if (duplicate) {
    return { ok: false, message: `That directory is already used by "${duplicate.name}".` }
  }
  return { ok: true, name, installPath }
}
