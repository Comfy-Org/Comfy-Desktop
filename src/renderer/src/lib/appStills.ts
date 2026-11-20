import type { AppCard } from '../types/ipc'

const PICTURE_URL = /\.(avif|gif|jpe?g|png|webp)(\?|#|$)/i

export function stillsOf(app: AppCard): string[] {
  return app.covers.flatMap((cover) => {
    if (cover.stillUrl) return [cover.stillUrl]
    return PICTURE_URL.test(cover.url) || cover.url.startsWith('data:image/') ? [cover.url] : []
  })
}
