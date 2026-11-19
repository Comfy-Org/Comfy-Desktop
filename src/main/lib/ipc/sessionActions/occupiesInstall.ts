const LOOKUPS_THAT_LEAVE_THE_INSTALL_ALONE: ReadonlySet<string> = new Set(['check-update'])

export function occupiesInstall(actionId: string): boolean {
  return !LOOKUPS_THAT_LEAVE_THE_INSTALL_ALONE.has(actionId)
}
