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
