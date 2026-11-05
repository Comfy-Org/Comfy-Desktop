export type TerminalPlatform = 'mac' | 'windows' | 'linux' | 'unknown'

export interface TerminalKeyEventLike {
  type: string
  key: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

export type TerminalKeyAction = 'copy' | 'paste' | 'swallow' | 'passthrough'

export function decideTerminalKeyAction(
  e: TerminalKeyEventLike,
  platform: TerminalPlatform,
  hasSelection: boolean
): TerminalKeyAction {
  if (e.type !== 'keydown') return 'passthrough'

  const key = e.key.toLowerCase()

  if (platform === 'mac') {
    const cmdOnly = e.metaKey && !e.ctrlKey && !e.altKey
    if (cmdOnly && key === 'c') return hasSelection ? 'copy' : 'swallow'
    if (cmdOnly && key === 'v') return 'paste'
    return 'passthrough'
  }

  const ctrlShift = e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey
  if (ctrlShift && key === 'c') return hasSelection ? 'copy' : 'swallow'
  if (ctrlShift && key === 'v') return 'paste'

  if (platform === 'windows') {
    const ctrlOnly = e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey
    if (ctrlOnly && key === 'c') return hasSelection ? 'copy' : 'passthrough'
    if (ctrlOnly && key === 'v') return 'paste'
  }

  return 'passthrough'
}
