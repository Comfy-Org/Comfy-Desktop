import { stripLogLevelPrefix } from './stderrTail'

const MARKER_RE = /ASSETS_STARTUP_FAILED: (\w+)/

export function parseAssetsStartupFailure(
  stderr: string | undefined
): { kind: string; message: string } | null {
  const lines = (stderr ?? '').split('\n').map((line) => stripLogLevelPrefix(line.trim()))
  const at = lines.findLastIndex((line) => MARKER_RE.test(line))
  if (at < 0) return null
  const rest = lines.slice(at + 1)
  const end = rest.findIndex((line) => line.includes('--disable-assets'))
  const message = rest.slice(0, end < 0 ? rest.length : end + 1).filter(Boolean)
  return { kind: MARKER_RE.exec(lines[at]!)![1]!, message: message.join('\n') }
}

export function isNewerAssetDbFailure(stderr: string | undefined): boolean {
  return (stderr ?? '').includes("Can't locate revision identified by")
}
