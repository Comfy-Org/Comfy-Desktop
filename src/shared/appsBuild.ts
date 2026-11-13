export function isAppsBuild(inst: object | null | undefined): boolean {
  return (inst as { appsBuild?: unknown } | null | undefined)?.appsBuild === true
}
