import { ref, watchEffect, type Ref } from 'vue'

export type ThumbnailFetcher = (savePath: string) => Promise<string | null>

interface ThumbnailEntry {
  isImage?: boolean
  status: string
  savePath?: string
}

const cache = new Map<string, string | null>()
const inflight = new Map<string, Promise<string | null>>()

export function useDownloadThumbnail(
  entry: () => ThumbnailEntry,
  fetcher: ThumbnailFetcher
): Ref<string | null> {
  const thumbnail = ref<string | null>(null)

  watchEffect(() => {
    const e = entry()
    thumbnail.value = null
    if (!e.isImage || e.status !== 'completed' || !e.savePath) return

    const savePath = e.savePath
    const cached = cache.get(savePath)
    if (cached !== undefined) {
      thumbnail.value = cached
      return
    }

    let pending = inflight.get(savePath)
    if (!pending) {
      pending = fetcher(savePath)
        .then((result) => {
          cache.set(savePath, result)
          inflight.delete(savePath)
          return result
        })
        .catch(() => {
          inflight.delete(savePath)
          return null
        })
      inflight.set(savePath, pending)
    }

    void pending.then((result) => {
      if (entry().savePath === savePath) thumbnail.value = result
    })
  })

  return thumbnail
}
