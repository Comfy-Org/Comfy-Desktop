import { BrowserWindow } from 'electron'
import { SPLASH_DESKTOP } from './theme'
import { showSplashPage } from './relaunchPage'
import * as i18n from './i18n'

export const UPDATE_INSTALL_COUNTDOWN_SECONDS = 5

export interface UpdateInstallSplash {
  window: BrowserWindow
  showInstallCountdown: () => Promise<void>
}

export function showUpdateInstallSplash(): UpdateInstallSplash {
  const win = new BrowserWindow({
    width: 480,
    height: 400,
    frame: false,
    resizable: false,
    center: true,
    show: false,
    backgroundColor: SPLASH_DESKTOP.bg,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return
    win.show()
    win.focus()
  })

  let render: Promise<void> = showSplashPage(win.webContents, SPLASH_DESKTOP, {
    title: i18n.t('launch.updateCheckTitle'),
    desc: i18n.t('launch.updateCheckDesc')
  }).catch(() => {})

  return {
    window: win,
    showInstallCountdown: () => {
      render = render
        .then(() => {
          if (win.isDestroyed()) return
          return showSplashPage(win.webContents, SPLASH_DESKTOP, {
            title: i18n.t('launch.updateInstallTitle'),
            desc: i18n.t('launch.updateInstallDesc'),
            countdownSeconds: UPDATE_INSTALL_COUNTDOWN_SECONDS
          })
        })
        .catch(() => {})
      return render
    }
  }
}
