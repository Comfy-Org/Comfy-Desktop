/**
 * A small syntax highlighter for Build's code samples (bash, Python,
 * JavaScript, JSON, prose prompts). The samples are ours and short, so a
 * single-pass tokenizer is enough and keeps shiki's weight out of the
 * prototype. Tokens map to `.hl-*` classes, coloured per theme in
 * `buildStart.css`.
 */
export type Lang = 'bash' | 'python' | 'js' | 'json' | 'text'
export type TokenKind =
  | 'kw'
  | 'str'
  | 'num'
  | 'com'
  | 'fn'
  | 'key'
  | 'var'
  | 'flag'
  | 'punc'
  | 'plain'
  | 'secret'
export interface Token {
  kind: TokenKind
  text: string
}

const KEYWORDS: Record<Lang, string[]> = {
  bash: ['curl', 'jq', 'export', 'echo', 'npx', 'pip', 'npm', 'claude', 'uvx'],
  python: ['import', 'from', 'as', 'def', 'return', 'with', 'for', 'in', 'if', 'print', 'None'],
  js: ['import', 'from', 'const', 'await', 'async', 'new', 'return', 'export', 'for', 'of'],
  json: ['true', 'false', 'null'],
  text: []
}

// One alternation, tried left to right at each position.
const RULES: { kind: TokenKind; re: RegExp; langs?: Lang[] }[] = [
  { kind: 'secret', re: /comfyui-[A-Za-z0-9•]{6,}/y },
  { kind: 'com', re: /#[^\n]*/y, langs: ['bash', 'python'] },
  { kind: 'com', re: /\/\/[^\n]*/y, langs: ['js'] },
  { kind: 'str', re: /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`]*`/y },
  { kind: 'var', re: /\$[A-Z_][A-Z0-9_]*|\$\{[^}]+\}/y, langs: ['bash'] },
  { kind: 'flag', re: /(?<=\s)--?[a-zA-Z][\w-]*/y, langs: ['bash'] },
  { kind: 'num', re: /\b\d+(?:\.\d+)?\b/y, langs: ['bash', 'python', 'js', 'json'] },
  { kind: 'fn', re: /[A-Za-z_][\w]*(?=\()/y, langs: ['python', 'js'] },
  { kind: 'plain', re: /[A-Za-z_][\w-]*/y },
  { kind: 'punc', re: /[{}()[\]:,.=\\|]/y }
]

export function tokenize(src: string, lang: Lang): Token[] {
  const out: Token[] = []
  const push = (kind: TokenKind, text: string): void => {
    const last = out[out.length - 1]
    if (last && last.kind === kind && kind === 'plain') last.text += text
    else out.push({ kind, text })
  }
  let i = 0
  scan: while (i < src.length) {
    if (lang !== 'text') {
      for (const r of RULES) {
        if (r.langs && !r.langs.includes(lang)) continue
        r.re.lastIndex = i
        const m = r.re.exec(src)
        if (!m || !m[0]) continue
        let kind = r.kind
        // A string followed by ':' in JSON or a JS object is a key.
        if (kind === 'str' && lang === 'json' && src[i + m[0].length] === ':') kind = 'key'
        if (kind === 'plain' && KEYWORDS[lang].includes(m[0])) kind = 'kw'
        push(kind, m[0])
        i += m[0].length
        continue scan
      }
    } else {
      // Prompts: only the key stands out.
      const r = RULES[0]!
      r.re.lastIndex = i
      const m = r.re.exec(src)
      if (m) {
        push('secret', m[0])
        i += m[0].length
        continue
      }
    }
    push('plain', src[i]!)
    i++
  }
  return out
}
