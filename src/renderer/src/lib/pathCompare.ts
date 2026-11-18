export function canonPath(p: string, win: boolean): string {
  const sep = win ? '\\' : '/'
  let rest = win ? p.replace(/\//g, '\\') : p
  if (win && /^[a-zA-Z]:/.test(rest) && rest[2] !== '\\') {
    return rest.toLowerCase()
  }
  let root = ''
  let clampDepth = 0
  if (win) {
    if (rest.startsWith('\\\\')) {
      root = '\\\\'
      rest = rest.slice(2)
      clampDepth = 2
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

export function samePath(a: string, b: string, win: boolean): boolean {
  if (!a || !b) return false
  return canonPath(a, win) === canonPath(b, win)
}
