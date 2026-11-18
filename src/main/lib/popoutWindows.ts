import { disposeTerminal } from './terminal'
import { closeAllLogsPopouts, closeLogsPopout } from './logsPopoutWindow'
import { closeAllTerminalPopouts, closeTerminalPopout } from './terminalPopoutWindow'

export function closeInstallPopouts(installationId: string): void {
  closeTerminalPopout(installationId)
  closeLogsPopout(installationId)
}

export function closeAllPopouts(): void {
  closeAllTerminalPopouts()
  closeAllLogsPopouts()
}

export function releaseInstallTerminalForFsOp(installationId: string): void {
  closeInstallPopouts(installationId)
  disposeTerminal(installationId)
}
