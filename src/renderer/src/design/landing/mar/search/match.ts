/**
 * Fuzzy match for the search palette: a run of the query inside the text
 * beats pieces of it at word starts. Returns the score (higher is better)
 * and the matched character indices, for highlighting; `null` when the
 * text does not match.
 */
export interface Match {
  score: number
  at: number[]
}

export function match(text: string, query: string): Match | null {
  const t = text.toLowerCase()
  const q = query.toLowerCase().trim()
  if (!q) return { score: 0, at: [] }

  const i = t.indexOf(q)
  if (i >= 0) {
    return {
      score: 300 - i + (isStart(t, i) ? 100 : 0) - t.length / 100,
      at: Array.from({ length: q.length }, (_, k) => i + k)
    }
  }

  // Otherwise pieces of the query at word starts, in order: "pr re"
  // finds "product-relight", "ltx vid" finds "LTX 2.5: Image to Video".
  // Letters scattered inside words don't count, so results stay few.
  const at = chunks(t, q.replace(/\s+/g, ''), 0, -1)
  if (!at) return null
  return { score: 100 - at[0]! - t.length / 100, at }
}

const isStart = (t: string, k: number): boolean => k === 0 || /[\s\-_.:]/.test(t[k - 1]!)

/** Matches `q` from `from` on, each letter either right after the last
 *  match or at a word start; the indices, or null. */
function chunks(t: string, q: string, from: number, last: number): number[] | null {
  if (!q) return []
  const ch = q[0]!
  if (last >= 0 && t[last + 1] === ch) {
    const rest = chunks(t, q.slice(1), last + 2, last + 1)
    if (rest) return [last + 1, ...rest]
  }
  for (let k = from; k < t.length; k++) {
    if (t[k] !== ch || !isStart(t, k)) continue
    const rest = chunks(t, q.slice(1), k + 1, k)
    if (rest) return [k, ...rest]
  }
  return null
}

/** Text split into plain and matched runs, for `<mark>`. */
export function segments(text: string, at: number[]): { text: string; hit: boolean }[] {
  const on = new Set(at)
  const out: { text: string; hit: boolean }[] = []
  for (let k = 0; k < text.length; k++) {
    const hit = on.has(k)
    const last = out[out.length - 1]
    if (last && last.hit === hit) last.text += text[k]
    else out.push({ text: text[k]!, hit })
  }
  return out
}
