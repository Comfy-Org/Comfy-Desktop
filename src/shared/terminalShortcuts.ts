// OS-aware copy/paste shortcut handling for the xterm.js consoles.
//
// Lives in `src/shared` because it is the single source of truth for the
// shortcut matrix: the renderer's ConsoleTerminalPane imports it directly, and
// the injected stopgap terminal (comfyTerminalContentScript.ts) embeds this
// exact function via `decideTerminalKeyAction.toString()` so the two can never
// drift apart.
//
// Terminals are special: Ctrl+C is the shell's interrupt (SIGINT, echoed as
// "^C"), so a terminal can't blindly treat it as "copy". Each OS resolves this
// differently, and we mirror the platform's native terminal so the shortcuts
// feel familiar:
//
//   macOS    — Cmd+C copies, Cmd+V pastes; Ctrl+C is always SIGINT.
//   Windows  — Ctrl+Shift+C / Ctrl+Shift+V always copy / paste (Windows
//              Terminal). Ctrl+C copies *only when text is selected*, otherwise
//              it falls through as SIGINT; Ctrl+V pastes.
//   Linux    — Ctrl+Shift+C / Ctrl+Shift+V copy / paste (GNOME Terminal et al);
//              Ctrl+C is always SIGINT.

/** Coarse OS bucket the shortcut matrix branches on. */
export type TerminalPlatform = 'mac' | 'windows' | 'linux' | 'unknown'

/** A minimal shape of `KeyboardEvent` so the decision is trivially unit-testable. */
export interface TerminalKeyEventLike {
  type: string
  key: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

/**
 * What the terminal should do with a key event:
 * - `copy` / `paste`  — run the clipboard action and swallow the key.
 * - `swallow`         — recognized copy/paste shortcut that's a no-op right now
 *                       (e.g. copy with no selection); swallow so it never
 *                       leaks a stray control byte (like ^C) to the shell.
 * - `passthrough`     — let xterm handle it normally (includes Ctrl+C → SIGINT).
 */
export type TerminalKeyAction = 'copy' | 'paste' | 'swallow' | 'passthrough'

export function decideTerminalKeyAction(
  e: TerminalKeyEventLike,
  platform: TerminalPlatform,
  hasSelection: boolean,
): TerminalKeyAction {
  // Only act on key-down; key-up/press for the same chord would double-fire.
  if (e.type !== 'keydown') return 'passthrough'

  const key = e.key.toLowerCase()

  if (platform === 'mac') {
    // Cmd (meta) without Ctrl/Alt. Cmd+C never interrupts, so a no-op copy is
    // swallowed rather than passed through.
    const cmdOnly = e.metaKey && !e.ctrlKey && !e.altKey
    if (cmdOnly && key === 'c') return hasSelection ? 'copy' : 'swallow'
    if (cmdOnly && key === 'v') return 'paste'
    return 'passthrough'
  }

  // Windows + Linux: Ctrl+Shift+C / Ctrl+Shift+V are the always-on shortcuts.
  const ctrlShift = e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey
  if (ctrlShift && key === 'c') return hasSelection ? 'copy' : 'swallow'
  if (ctrlShift && key === 'v') return 'paste'

  if (platform === 'windows') {
    // Windows Terminal: bare Ctrl+C copies when text is selected, else SIGINT;
    // bare Ctrl+V pastes.
    const ctrlOnly = e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey
    if (ctrlOnly && key === 'c') return hasSelection ? 'copy' : 'passthrough'
    if (ctrlOnly && key === 'v') return 'paste'
  }

  return 'passthrough'
}
