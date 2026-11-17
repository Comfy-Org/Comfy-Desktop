import type { WebContents } from 'electron'
import { showSplashPage } from '../lib/relaunchPage'
import type { SplashTheme } from '../lib/theme'
import type { ComfyWindowEntry } from './registry'

export const LOAD_RETRY_DELAY_MS = 2000

export type NavigationResult = 'loaded' | 'superseded'

export interface AttachedBuild {
  reloadUrl: () => string
  mayReload: () => boolean
}

export interface SplashReopen {
  url: string
  theme: SplashTheme
  copy: { title: string; desc: string }
  reveal: () => boolean
}

export interface BuildNavigator {
  attach(build: AttachedBuild): void
  detach(): void
  open(url: string): Promise<NavigationResult>
  startOpening(url: string): void
  refresh(): void
  readonly retryPending: boolean
  retryAfterFailure(): void
  showSplash(theme: SplashTheme): Promise<void>
  reopenBehindSplash(reopen: SplashReopen): Promise<void>
  keepCurrentPage(): void
  blank(): void
}

function createBuildNavigator(entry: ComfyWindowEntry): BuildNavigator {
  let latestNavigation = 0
  let latestReopen = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let build: AttachedBuild | null = null

  const contents = (): WebContents => entry.comfyView.webContents

  const cancelRetry = (): void => {
    if (!retryTimer) return
    clearTimeout(retryTimer)
    retryTimer = null
  }

  const supersedeEarlierNavigations = (): number => {
    cancelRetry()
    return ++latestNavigation
  }

  const open = async (url: string): Promise<NavigationResult> => {
    const navigation = supersedeEarlierNavigations()
    try {
      await contents().loadURL(url)
    } catch (error) {
      if (navigation === latestNavigation) throw error
      return 'superseded'
    }
    return navigation === latestNavigation ? 'loaded' : 'superseded'
  }

  const startOpening = (url: string): void => {
    void open(url).catch(() => {})
  }

  return {
    attach(attached) {
      build = attached
    },

    detach() {
      build = null
      latestReopen++
      supersedeEarlierNavigations()
    },

    open,

    startOpening,

    refresh() {
      if (!build || entry.window.isDestroyed() || !build.mayReload()) return
      const url = build.reloadUrl()
      contents().stop()
      startOpening(url)
    },

    get retryPending() {
      return retryTimer !== null
    },

    retryAfterFailure() {
      if (retryTimer || !build || !build.mayReload()) return
      const failedBuild = build
      retryTimer = setTimeout(() => {
        retryTimer = null
        if (build !== failedBuild || !failedBuild.mayReload() || entry.window.isDestroyed()) return
        startOpening(failedBuild.reloadUrl())
      }, LOAD_RETRY_DELAY_MS)
    },

    async showSplash(theme) {
      supersedeEarlierNavigations()
      await showSplashPage(contents(), theme)
    },

    async reopenBehindSplash({ url, theme, copy, reveal }) {
      const reopen = ++latestReopen
      const navigation = supersedeEarlierNavigations()
      const splashed = contents()
      await showSplashPage(splashed, theme, copy).catch(() => {})
      if (reopen !== latestReopen || entry.window.isDestroyed() || splashed.isDestroyed()) return
      if (!reveal()) return
      if (navigation === latestNavigation) startOpening(url)
    },

    keepCurrentPage() {
      supersedeEarlierNavigations()
    },

    blank() {
      supersedeEarlierNavigations()
      void contents()
        .loadURL('about:blank')
        .catch(() => {})
    }
  }
}

const navigators = new WeakMap<ComfyWindowEntry, BuildNavigator>()

export function navigatorFor(entry: ComfyWindowEntry): BuildNavigator {
  let navigator = navigators.get(entry)
  if (!navigator) {
    navigator = createBuildNavigator(entry)
    navigators.set(entry, navigator)
  }
  return navigator
}
