const loads = new Map<string, Promise<boolean>>()
const decoded = new Map<string, HTMLImageElement>()

export function isMovingCoverReady(url: string): boolean {
  return decoded.has(url)
}

export function loadMovingCover(url: string): Promise<boolean> {
  const started = loads.get(url)
  if (started) return started
  const image = new Image()
  image.src = url
  const load = image.decode().then(
    () => {
      decoded.set(url, image)
      return true
    },
    () => {
      loads.delete(url)
      return false
    }
  )
  loads.set(url, load)
  return load
}

export function forgetMovingCoversForTest(): void {
  loads.clear()
  decoded.clear()
}
