import { WebContentsView } from 'electron'

import { keepOnDesktopPage } from './desktopPageLock'

const viewsWithLiveWebContents = new Set<WebContentsView>()

export function createWebContentsView(
  options?: Electron.WebContentsViewConstructorOptions
): WebContentsView {
  const view = new WebContentsView(options)
  viewsWithLiveWebContents.add(view)
  view.webContents.once('destroyed', () => {
    releaseAfterNativeDestructionCompletes(view)
  })
  return view
}

export function createDesktopPageView(
  options?: Electron.WebContentsViewConstructorOptions
): WebContentsView {
  const view = createWebContentsView(options)
  keepOnDesktopPage(view.webContents)
  return view
}

function releaseAfterNativeDestructionCompletes(view: WebContentsView): void {
  setImmediate(() => viewsWithLiveWebContents.delete(view))
}
