import { BrowserWindow } from 'electron'
import { SPLASH_PURPLE } from './theme'
import { showSplashPage } from './relaunchPage'
import * as i18n from './i18n'

/** Countdown shown on the update splash once the install is committed, before
 *  the app quits to run it, so the user has a few seconds to read what's about
 *  to happen. Keep in sync with the updater's `STARTUP_INSTALL_MIN_SPLASH_MS`
 *  (the post-commit hold), so the countdown finishes right as the install
 *  begins. */
export const UPDATE_INSTALL_COUNTDOWN_SECONDS = 5

/** Handle for the startup-update splash. `showInstallCountdown` swaps the copy
 *  from "checking for update" to the install countdown; the updater calls it at
 *  the moment the install is committed, so the countdown never shows for a boot
 *  that ends up skipping the install. The returned promise settles once the
 *  countdown page is rendered (or its render failed), letting the caller start
 *  the pre-quit hold only when the countdown is actually visible. */
export interface UpdateInstallSplash {
  window: BrowserWindow
  showInstallCountdown: () => Promise<void>
}

/**
 * Splash window shown while a previously-downloaded Desktop update is checked
 * and possibly applied at startup (see `applyPendingUpdateOnStartup`). It opens
 * with "checking" copy while the bounded readiness check runs; if the install
 * commits, the caller swaps in the install countdown via `showInstallCountdown`
 * and the app quits shortly after (the installer relaunches it). If the install
 * doesn't proceed, the caller destroys this window after opening the normal UI.
 *
 * Self-contained (renders the shared brand splash into its own webContents), so
 * it has no dependency on the host-window / panel renderer wiring that isn't up
 * yet this early in boot.
 */
export function showUpdateInstallSplash(): UpdateInstallSplash {
  const win = new BrowserWindow({
    width: 480,
    height: 400,
    frame: false,
    resizable: false,
    center: true,
    show: false,
    backgroundColor: SPLASH_PURPLE.bg,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return
    // Show + focus so the splash comes up frontmost like any normal app window
    // (a window spawned this early can otherwise open without taking focus).
    win.show()
    win.focus()
  })

  // Renders are chained so the countdown swap can't race the initial checking
  // page while it is still loading (a second loadURL aborts the first, which
  // would reject its promise). The splash is best-effort chrome, so render
  // failures are swallowed rather than propagated into the update flow.
  let render: Promise<void> = showSplashPage(win.webContents, SPLASH_PURPLE, {
    title: i18n.t('launch.updateCheckTitle'),
    desc: i18n.t('launch.updateCheckDesc')
  }).catch(() => {})

  return {
    window: win,
    showInstallCountdown: () => {
      render = render
        .then(() => {
          if (win.isDestroyed()) return
          return showSplashPage(win.webContents, SPLASH_PURPLE, {
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
