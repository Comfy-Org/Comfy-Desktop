import path from 'path'

/**
 * Resolve the install root when the user pointed at the nested `ComfyUI/` folder
 * inside a managed install (standalone or portable). Returns the parent only
 * when the picked directory is named `ComfyUI` and the parent satisfies
 * `parentHasMarker` (the source's own layout check). Returns null otherwise.
 *
 * Shared by the standalone and portable probes so the ascend rule stays
 * consistent across them.
 */
export function resolveNestedComfyUIParent(
  dirPath: string,
  parentHasMarker: (parent: string) => boolean,
): string | null {
  const parent = path.dirname(dirPath)
  if (parent !== dirPath && path.basename(dirPath).toLowerCase() === 'comfyui' && parentHasMarker(parent)) {
    return parent
  }
  return null
}
