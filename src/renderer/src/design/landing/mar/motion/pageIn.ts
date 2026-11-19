/**
 * A page's entry, as pageTransition.ts plays it in the app and the DS's
 * Motion page plays it in its specimen. Kept apart from the store so the
 * DS can play it without the app's watcher.
 */
export type PageTransition = 'off' | 'fade' | 'rise' | 'stagger'

/** The tokens, read from motion.css when a page plays. */
function tokens(): { dur: number; fade: number; rise: number; step: number; ease: string } {
  const s = getComputedStyle(document.documentElement)
  const ms = (name: string, fallback: number): number =>
    parseFloat(s.getPropertyValue(name)) || fallback
  return {
    dur: ms('--mar-page-in', 240),
    fade: ms('--mar-page-fade', 160),
    rise: ms('--mar-page-rise', 6),
    step: ms('--mar-page-step', 40),
    ease: s.getPropertyValue('--mar-ease-page').trim() || 'cubic-bezier(0.22, 1, 0.36, 1)'
  }
}

// At most this many sections get their own beat; the rest come in with
// the last one, so a long page never takes long to settle.
const BEATS = 5

/** The page's sections: the first level under the page with more than one
 *  block (pages wrap their content in a container or two). */
function sections(page: HTMLElement): HTMLElement[] {
  let el = page
  for (let depth = 0; depth < 4; depth++) {
    const kids = [...el.children].filter(
      (c): c is HTMLElement => c instanceof HTMLElement && c.offsetHeight > 0
    )
    if (kids.length > 1) return kids
    if (!kids[0]) break
    el = kids[0]
  }
  return [page]
}

/** Plays a page's entry on `pages` (the new page's top elements) and
 *  returns the animations, so the caller can cancel them. */
export function playPageIn(
  pages: HTMLElement[],
  kind: PageTransition,
  reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
): Animation[] {
  if (kind === 'off' || !pages.length) return []
  const t = tokens()
  if (reduced || kind === 'fade') {
    const dur = reduced ? Math.min(t.fade, 120) : t.fade
    return pages.map((el) => el.animate({ opacity: [0, 1] }, { duration: dur, easing: 'ease-out' }))
  }
  const rise = (el: HTMLElement, delay: number, px: number): Animation =>
    el.animate(
      { opacity: [0, 1], transform: [`translateY(${px}px)`, 'none'] },
      // `backwards`: a section waiting for its beat is already hidden.
      { duration: t.dur, delay, easing: t.ease, fill: 'backwards' }
    )
  if (kind === 'rise') return pages.map((el) => rise(el, 0, t.rise))
  return pages.flatMap((page) =>
    sections(page).map((el, i) => rise(el, Math.min(i, BEATS - 1) * t.step, t.rise + 2))
  )
}
