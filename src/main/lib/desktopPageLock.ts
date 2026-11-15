import type { WebContents } from 'electron'

function withoutFragment(url: string): string {
  const fragmentStart = url.indexOf('#')
  return fragmentStart === -1 ? url : url.slice(0, fragmentStart)
}

export function keepOnDesktopPage(contents: WebContents): void {
  contents.on('will-navigate', (event, url) => {
    if (withoutFragment(url) === withoutFragment(contents.getURL())) return
    event.preventDefault()
  })
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
}
