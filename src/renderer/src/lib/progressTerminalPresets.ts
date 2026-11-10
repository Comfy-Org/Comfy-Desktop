export interface SuccessTerminal {
  title?: string
  actions: SuccessTerminalAction[]
}

export interface SuccessTerminalAction {
  id: string
  label: string
  variant: 'primary' | 'ghost'
}

export const SUCCESS_ACTION_GO_DASHBOARD = 'go-dashboard'
export const SUCCESS_ACTION_OPEN_INSTANCE = 'open-instance'

export function successTerminalGoDashboardOrOpen(opts: {
  title?: string
  dashboardLabel: string
  openLabel: string
}): SuccessTerminal {
  return {
    ...(opts.title === undefined ? {} : { title: opts.title }),
    actions: [
      { id: SUCCESS_ACTION_GO_DASHBOARD, label: opts.dashboardLabel, variant: 'ghost' },
      { id: SUCCESS_ACTION_OPEN_INSTANCE, label: opts.openLabel, variant: 'primary' }
    ]
  }
}
