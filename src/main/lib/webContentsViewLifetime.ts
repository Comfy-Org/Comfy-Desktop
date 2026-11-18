import { WebContentsView } from 'electron'

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

function releaseAfterNativeDestructionCompletes(view: WebContentsView): void {
  setImmediate(() => viewsWithLiveWebContents.delete(view))
}
