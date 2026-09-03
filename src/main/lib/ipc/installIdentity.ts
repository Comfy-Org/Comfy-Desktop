import { allocateUniqueDir, findDuplicatePath, sanitizeDirName, uniqueName } from './shared'

/** Resolved identity for a new installation record. `installPath` is present
 *  exactly when an install root was given. */
export type InstallIdentity =
  | { ok: true; name: string; installPath?: string }
  | { ok: false; message: string }

/** Resolve a collision-free display name and, when an install root is given,
 *  a unique directory under it for a new installation, refusing a directory
 *  already owned by another record. Shared by the generic `add-installation`
 *  handler and the managed build install so the two allocation flows cannot
 *  drift apart. */
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
