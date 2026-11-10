export function isTerminalRelease(status: string): boolean {
  return status === 'complete' || status === 'stopped'
}
