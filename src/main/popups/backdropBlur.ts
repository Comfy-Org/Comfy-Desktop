export const BACKDROP_BLUR_CSS = 'html { filter: blur(8px) saturate(115%); }'

export interface BlurrableContents {
  isDestroyed(): boolean
  getURL(): string
  insertCSS(css: string): Promise<string>
  removeInsertedCSS(key: string): Promise<void>
}

const STAYS_SHARP = ['comfyTitlePopup.html', 'comfyTitleBar.html', 'data:']

export function staysSharpBehindBackdrop(url: string): boolean {
  return STAYS_SHARP.some((marker) => url.includes(marker))
}

export function blurContentsBehindBackdrop(contents: readonly BlurrableContents[]): () => void {
  const applied: Array<{ contents: BlurrableContents; key: Promise<string | null> }> = []
  for (const item of contents) {
    if (item.isDestroyed() || staysSharpBehindBackdrop(item.getURL())) continue
    applied.push({
      contents: item,
      key: item.insertCSS(BACKDROP_BLUR_CSS).catch(() => null)
    })
  }
  return () => {
    for (const { contents: item, key } of applied) {
      void key.then((resolved) => {
        if (resolved === null || item.isDestroyed()) return
        return item.removeInsertedCSS(resolved).catch(() => {})
      })
    }
  }
}
