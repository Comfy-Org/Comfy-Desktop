import { stripLogLevelPrefix } from './stderrTail'

const MARKER_RE = /ASSETS_STARTUP_FAILED: (\w+)/

/**
 * ComfyUI's refusal to start when its asset database cannot open: a line
 * `ASSETS_STARTUP_FAILED: <kind>` (after any log-level tag), then a message for the user that
 * ends with the `--disable-assets` hint. Null when stderr carries no marker (older cores).
 * Matched anywhere in the line, so a coloured tag in front does not hide it.
 */
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
