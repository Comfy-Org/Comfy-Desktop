import type { MessageBoxSyncOptions } from 'electron'

type Translate = (key: string, params?: Record<string, string | number>) => string

export interface AppsQuitState {
  running: number
  onlyTitle: string | null
  downloading: boolean
}

export const QUIT_BUTTON = 0

export function appsQuitPrompt(state: AppsQuitState, t: Translate): MessageBoxSyncOptions | null {
  if (state.running === 0) return null
  const runs =
    state.running === 1 && state.onlyTitle !== null
      ? t('appsQuit.detailOne', { app: state.onlyTitle })
      : t('appsQuit.detailMany', { count: state.running })
  return {
    type: 'warning',
    buttons: [t('appsQuit.quit'), t('appsQuit.cancel')],
    defaultId: 1,
    cancelId: 1,
    message: t('appsQuit.message'),
    detail: state.downloading ? `${runs}\n\n${t('templateQuit.message')}` : runs
  }
}
