import { stripAnsi } from './stderrTail'

/**
 * Coarse milestones parsed from `uv pip install`'s human output — it offers no
 * machine-readable progress (astral-sh/uv#9129).
 *
 * Piped stdio suppresses uv's progress bars, so no byte counts, percentages or
 * speeds exist to read: a percentage bar cannot be built from this. Downloads
 * under 1 MiB announce nothing at all.
 */
export type UvStage = 'resolving' | 'preparing' | 'installing' | 'done'

export interface UvProgress {
  stage: UvStage
  /** Package currently downloading, when uv named one. */
  currentPackage?: string
  /** Human size uv reported for `currentPackage`, verbatim (e.g. `2.7GiB`). */
  currentSize?: string
  /** Packages uv resolved, once it says so. */
  resolvedCount?: number
}

// uv indents its completion lines, so every pattern tolerates leading space.
const RESOLVED_RE = /^\s*Resolved (\d+) packages? in /
const PREPARED_RE = /^\s*Prepared (\d+) packages?(?: without build isolation)? in /
const INSTALLED_RE = /^\s*Installed (\d+) packages?(?: without build isolation)? in /
const AUDITED_RE = /^\s*Audited (\d+) packages? in /
const DOWNLOADING_RE = /^\s*Downloading (\S+)(?: \(([^)]+)\))?\s*$/
const DOWNLOADED_RE = /^\s*Downloaded (\S+)\s*$/

/** Ceiling on an unterminated line, so output that never breaks can't grow. */
const MAX_PARTIAL_LINE_CHARS = 8192

/**
 * Feed uv output through a line-buffered parser, calling `onProgress` when the
 * visible state changes. Chunks arrive on raw buffer boundaries and the two
 * streams interleave, so partial lines are held back until a newline arrives.
 */
export function createUvProgressParser(
  onProgress: (p: UvProgress) => void
): (chunk: string) => void {
  let buffer = ''
  const seenDownloads = new Set<string>()
  const state: UvProgress = { stage: 'resolving' }

  const emit = (): void => {
    try {
      onProgress({ ...state })
    } catch {}
  }

  const consumeLine = (raw: string): void => {
    const line = stripAnsi(raw)
    if (!line.trim()) return

    const resolved = RESOLVED_RE.exec(line)
    if (resolved) {
      state.stage = 'resolving'
      state.resolvedCount = Number(resolved[1])
      emit()
      return
    }

    const downloading = DOWNLOADING_RE.exec(line)
    if (downloading) {
      const name = downloading[1]!
      // Some uv versions print `Downloading` on completion too, so a repeat is
      // that line, not a second download.
      if (seenDownloads.has(name)) return
      seenDownloads.add(name)
      state.stage = 'preparing'
      state.currentPackage = name
      state.currentSize = downloading[2]
      emit()
      return
    }

    if (DOWNLOADED_RE.test(line)) {
      state.currentPackage = undefined
      state.currentSize = undefined
      emit()
      return
    }

    if (PREPARED_RE.test(line)) {
      state.stage = 'installing'
      state.currentPackage = undefined
      state.currentSize = undefined
      emit()
      return
    }

    if (INSTALLED_RE.test(line) || AUDITED_RE.test(line)) {
      state.stage = 'done'
      state.currentPackage = undefined
      state.currentSize = undefined
      emit()
    }
  }

  return (chunk: string): void => {
    buffer += chunk
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      consumeLine(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
    }
    if (buffer.length > MAX_PARTIAL_LINE_CHARS) buffer = buffer.slice(-1024)
  }
}
