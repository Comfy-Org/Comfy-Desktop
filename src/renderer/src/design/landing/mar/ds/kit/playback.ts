/**
 * Motion controls for every frame (pages/MotionPage.vue): a speed and a
 * reduced-motion preview, set once on the page and heard by every frame
 * over a BroadcastChannel (and kept for frames that open later).
 *
 * Speed sets `playbackRate` on every running animation and transition.
 * Reduced motion can't flip the media query, so it copies every rule
 * written for `prefers-reduced-motion: reduce` into a sheet that is
 * switched on, and stops what only runs under `no-preference`. Code that
 * reads `matchMedia` once at load (the banner, the prompt, the bloom)
 * doesn't follow; the Motion page says which.
 */
export interface Playback {
  speed: number
  reduced: boolean
  /** Bumped to replay every specimen. */
  replay: number
}

const KEY = 'mar-ds.playback'
const channel = new BroadcastChannel('mar-ds.playback')

export function readPlayback(): Playback {
  try {
    return { speed: 1, reduced: false, replay: 0, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return { speed: 1, reduced: false, replay: 0 }
  }
}

export function setPlayback(next: Partial<Playback>): void {
  const p = { ...readPlayback(), ...next }
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    // Storage blocked: the frames still hear it below.
  }
  channel.postMessage(p)
  apply(p)
}

export function onPlayback(fn: (p: Playback) => void): () => void {
  const listen = (e: MessageEvent<Playback>): void => fn(e.data)
  channel.addEventListener('message', listen)
  return () => channel.removeEventListener('message', listen)
}

const REDUCE = /prefers-reduced-motion:\s*reduce/
const NO_PREF = /prefers-reduced-motion:\s*no-preference/

/** The rules a reduced-motion preference turns on (and the selectors it
 *  turns off), from every stylesheet in the document. */
function collect(): string {
  const on: string[] = []
  const off: string[] = []
  // `selector`: the rule a nested media query sits in (Tailwind 4 nests
  // `motion-safe:` and `motion-reduce:` inside their class).
  const walk = (rules: CSSRuleList, inReduce: boolean, inNoPref: boolean, selector = ''): void => {
    for (const r of rules) {
      if (r instanceof CSSMediaRule) {
        const reduce = inReduce || REDUCE.test(r.conditionText)
        const noPref = inNoPref || NO_PREF.test(r.conditionText)
        walk(r.cssRules, reduce, noPref, selector)
      } else if (r instanceof CSSStyleRule) {
        if (r.cssRules.length) walk(r.cssRules, inReduce, inNoPref, r.selectorText)
        if (inReduce) on.push(r.cssText)
        else if (inNoPref) off.push(r.selectorText)
      } else if (r instanceof CSSKeyframesRule) {
        continue
      } else if ('cssRules' in r) {
        walk((r as CSSGroupingRule).cssRules, inReduce, inNoPref, selector)
      } else if (selector && 'style' in r) {
        // Declarations nested straight in a media query in a rule.
        const text = (r as CSSStyleRule).style.cssText
        if (inReduce) on.push(`${selector} { ${text} }`)
        else if (inNoPref) off.push(selector)
      }
    }
  }
  for (const sheet of document.styleSheets) {
    try {
      walk(sheet.cssRules, false, false)
    } catch {
      // A cross-origin sheet (fonts): nothing of ours in it.
    }
  }
  // One bad selector would drop the whole list, so each is checked.
  const valid = [...new Set(off)].filter(
    (sel) => !sel.includes('&') && CSS.supports(`selector(${sel})`)
  )
  const stop = valid.length
    ? `${valid.join(',\n')} { animation: none !important; transition: none !important; }`
    : ''
  return [...on, stop].join('\n')
}

let sheet: HTMLStyleElement | undefined
let rate = 1
let raf = 0

function tick(): void {
  for (const a of document.getAnimations()) if (a.playbackRate !== rate) a.playbackRate = rate
  raf = rate === 1 ? 0 : requestAnimationFrame(tick)
}

function apply(p: Playback): void {
  rate = p.speed
  if (rate !== 1 && !raf) raf = requestAnimationFrame(tick)
  if (rate === 1) for (const a of document.getAnimations()) a.playbackRate = 1
  if (p.reduced) {
    sheet ??= document.head.appendChild(document.createElement('style'))
    sheet.dataset.dsReduced = ''
    sheet.textContent = collect()
    document.documentElement.dataset.dsReduced = ''
  } else {
    sheet?.remove()
    sheet = undefined
    delete document.documentElement.dataset.dsReduced
  }
}

/** In every frame: start from the saved settings and follow changes. */
export function installPlayback(): void {
  // Once the app's styles are in.
  setTimeout(() => apply(readPlayback()), 400)
  onPlayback(apply)
}

/** Whether this frame is previewing reduced motion (for JS-driven motion). */
export const previewReduced = (): boolean => 'dsReduced' in document.documentElement.dataset
