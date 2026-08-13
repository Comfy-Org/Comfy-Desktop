/** Canonicalize a path for comparison, matching the backend's `isSamePath`
 *  (`path.resolve` + case-insensitive on Windows) as closely as the renderer
 *  can without fs/cwd access: unify separators, collapse repeats, resolve
 *  `.`/`..` segments lexically, drop trailing separators, and ignore case on
 *  Windows. Renderer paths are already absolute (browse results,
 *  backend-computed defaults, stored dirs); a drive-relative form like
 *  `C:foo` needs the main process's per-drive cwd, so it is left as-is. */
export function canonPath(p: string, win: boolean): string {
  const sep = win ? '\\' : '/'
  let rest = win ? p.replace(/\//g, '\\') : p
  // Drive-relative forms ("C:", "C:foo") resolve against the drive's cwd,
  // which only the main process knows: normalize case but leave segments.
  if (win && /^[a-zA-Z]:/.test(rest) && rest[2] !== '\\') {
    return rest.toLowerCase()
  }
  let root = ''
  let clampDepth = 0
  if (win) {
    if (rest.startsWith('\\\\')) {
      root = '\\\\'
      rest = rest.slice(2)
      clampDepth = 2 // \\server\share is the UNC root; ".." can't climb past it
    } else if (/^[a-zA-Z]:\\/.test(rest)) {
      root = rest.slice(0, 2) + '\\'
      rest = rest.slice(2)
    }
  } else if (rest.startsWith('/')) {
    root = '/'
  }
  const parts: string[] = []
  for (const seg of rest.split(sep)) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      if (parts.length > clampDepth && parts[parts.length - 1] !== '..') parts.pop()
      else if (!root) parts.push('..')
      continue
    }
    parts.push(seg)
  }
  const out = root + parts.join(sep)
  return win ? out.toLowerCase() : out
}

/** Platform-aware path equality on canonicalized forms. */
export function samePath(a: string, b: string, win: boolean): boolean {
  if (!a || !b) return false
  return canonPath(a, win) === canonPath(b, win)
}
