// eslint-disable-next-line no-control-regex
const ANSI_RE = /[\u001B\u009B][#();?[]*(?:\d{1,4}(?:;\d{0,4})*)?[\d<=>A-ORZcf-nqry]/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}

export function lastNLines(text: string, n: number): string {
  return text.split('\n').slice(-n).join('\n')
}

// ComfyUI Desktop's bundled build logs every line with a level tag
// (`[INFO] Device: ...`, `[ERROR] Failed to validate ...`), unlike ComfyUI's
// source default (`%(message)s`, no prefix). Log-line parsers anchored at `^`
// must strip this tag first or they silently match nothing on Desktop. A
// raw Python traceback (no logging format) has no tag, so this is a no-op there.
const LOG_LEVEL_PREFIX_RE = /^\[[A-Z]+\]\s+/

export function stripLogLevelPrefix(text: string): string {
  return text.replace(LOG_LEVEL_PREFIX_RE, '')
}

export type StreamSource = 'stdout' | 'stderr'

/** Cap on the unterminated tail carried between chunks, per stream. */
const MAX_PENDING_CHARS = 16_384

export interface StreamLineBuffer {
  /**
   * Complete lines from `chunk`, with any unterminated tail carried over to
   * the next call for this stream.
   */
  append(source: StreamSource, chunk: string): string[]
  /** The carried tail for this stream, cleared in the same step. */
  takePending(source: StreamSource): string
  /** Drop both streams' carried tails. */
  reset(): void
}

/**
 * Line buffering shared by the log taps, which read the same
 * `proc.stdout`/`proc.stderr` chunk streams.
 *
 * Buffers are per stream: stdout and stderr arrive as independent chunk
 * streams, so one shared buffer could splice unrelated partial lines together.
 * Each chunk is split BEFORE capping so a large chunk's complete lines are
 * never lost — only the unterminated tail is capped, since that is the sole
 * unbounded-growth risk.
 */
export function createStreamLineBuffer(
  maxPendingChars: number = MAX_PENDING_CHARS
): StreamLineBuffer {
  const pendingBySource: Record<StreamSource, string> = { stdout: '', stderr: '' }

  return {
    append(source, chunk) {
      const lines = (pendingBySource[source] + chunk).split(/\r?\n/)
      const tail = lines.pop() ?? ''
      pendingBySource[source] = tail.length > maxPendingChars ? tail.slice(-maxPendingChars) : tail
      return lines
    },
    takePending(source) {
      const pending = pendingBySource[source]
      pendingBySource[source] = ''
      return pending
    },
    reset() {
      pendingBySource.stdout = ''
      pendingBySource.stderr = ''
    }
  }
}
