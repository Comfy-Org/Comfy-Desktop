import { useAssetPrefetch, type AssetLoader } from './useAssetPrefetch'

interface PrefetchOptions {
  isBusy?: () => boolean
  concurrency?: number
  idleTimeoutMs?: number
}

const loadImage: AssetLoader = (url, done) => {
  const img = new Image()
  const settle = (): void => {
    img.onload = null
    img.onerror = null
    done()
  }
  img.onload = settle
  img.onerror = settle
  img.src = url
  return () => {
    img.onload = null
    img.onerror = null
  }
}

export function useThumbnailPrefetch(options: PrefetchOptions = {}): {
  prefetch: (urls: readonly (string | null | undefined)[]) => void
} {
  return useAssetPrefetch(loadImage, options)
}
