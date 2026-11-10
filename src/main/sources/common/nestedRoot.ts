import path from 'path'

export function resolveNestedComfyUIParent(
  dirPath: string,
  parentHasMarker: (parent: string) => boolean
): string | null {
  const parent = path.dirname(dirPath)
  if (
    parent !== dirPath &&
    path.basename(dirPath).toLowerCase() === 'comfyui' &&
    parentHasMarker(parent)
  ) {
    return parent
  }
  return null
}
