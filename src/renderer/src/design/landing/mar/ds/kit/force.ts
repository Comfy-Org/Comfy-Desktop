/**
 * Forced states for real components. The prototype styles hover, focus
 * and press with pseudo-classes only, which a page can't switch on. This
 * mirrors every rule that uses one into a copy that also answers to an
 * attribute:
 *
 *   [data-ds-force~=hover]       this element is hovered
 *   [data-ds-force-all~=hover]   this element and everything inside it
 *
 * (same for focus and active). The copies sit next to their originals
 * (same @layer, same @media), so they win exactly where the real state
 * would. Rebuilt whenever a stylesheet is added or changed (Vite HMR,
 * a component's styles loading late).
 */

type State = 'hover' | 'focus' | 'active'

const PSEUDOS: [RegExp, State][] = [
  [/(?<!\\):hover(?![\w-])/g, 'hover'],
  [/(?<!\\):focus-visible(?![\w-])/g, 'focus'],
  [/(?<!\\):focus-within(?![\w-])/g, 'focus'],
  [/(?<!\\):focus(?![\w-])/g, 'focus'],
  [/(?<!\\):active(?![\w-])/g, 'active']
]
const ANY = /(?<!\\):(hover|focus|focus-visible|focus-within|active)(?![\w-])/
// `@media (hover: hover)` is a media feature, not the pseudo-class.
const MEDIA_HOVER = /\(\s*hover\s*:\s*hover\s*\)/g
const MEDIA_TOKEN = '(__ds_media_hover__)'

const forced = (s: State): string =>
  `:is([data-ds-force~=${s}], [data-ds-force-all~=${s}], [data-ds-force-all~=${s}] *)`

function rewrite(css: string): string {
  let out = css.replace(MEDIA_HOVER, MEDIA_TOKEN)
  for (const [rx, s] of PSEUDOS) out = out.replace(rx, forced(s))
  return out.replaceAll(MEDIA_TOKEN, '(hover: hover)')
}

function prelude(rule: CSSRule): string {
  return rule.cssText.slice(0, rule.cssText.indexOf('{')).trim()
}

function mirror(rules: CSSRuleList, out: string[]): void {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      // Nested rules (`&:hover`) are inside cssText too, so one test covers both.
      if (ANY.test(rule.cssText.replace(MEDIA_HOVER, ''))) out.push(rewrite(rule.cssText))
    } else if (rule instanceof CSSGroupingRule || rule instanceof CSSLayerBlockRule) {
      const inner: string[] = []
      mirror((rule as CSSGroupingRule).cssRules, inner)
      if (inner.length) out.push(`${prelude(rule)} {\n${inner.join('\n')}\n}`)
    }
  }
}

const MARK = 'data-ds-mirror'

function rebuild(): void {
  document.querySelectorAll(`style[${MARK}]`).forEach((n) => n.remove())
  const out: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    if ((sheet.ownerNode as Element | null)?.hasAttribute?.(MARK)) continue
    try {
      mirror(sheet.cssRules, out)
    } catch {
      // A cross-origin sheet (fonts): nothing of ours in it.
    }
  }
  const style = document.createElement('style')
  style.setAttribute(MARK, '')
  style.textContent = out.join('\n')
  document.head.append(style)
}

let queued = 0
function schedule(): void {
  cancelAnimationFrame(queued)
  queued = requestAnimationFrame(rebuild)
}

export function installForcedStates(): void {
  schedule()
  new MutationObserver((records) => {
    const ours = (n: Node): boolean =>
      n instanceof Element ? n.hasAttribute(MARK) : !!n.parentElement?.hasAttribute(MARK)
    if (records.every((r) => ours(r.target) || [...r.addedNodes, ...r.removedNodes].every(ours)))
      return
    schedule()
  }).observe(document.head, { childList: true, subtree: true, characterData: true })
}

/**
 * The elements `target` names inside `root`. Each comma-separated part is a
 * selector, optionally ending in `::text(Label)`: then only those whose
 * text or aria-label is that label (so a cell keeps hitting “Explore” when
 * the rows above it change).
 */
function find(root: HTMLElement, target: string): HTMLElement[] {
  return target.split(/,(?![^(]*\))/).flatMap((part) => {
    const m = /^(.*)::text\((.+)\)$/.exec(part.trim())
    const els = Array.from(root.querySelectorAll<HTMLElement>(m ? m[1]! : part))
    if (!m) return els
    return els.filter(
      (el) => el.textContent?.trim() === m[2] || el.getAttribute('aria-label') === m[2]
    )
  })
}

/** Puts `states` on every element matching `target` inside `root` (or on
 *  everything in it with no target), and keeps them through re-renders. */
export function forceStates(
  root: HTMLElement,
  states: string,
  target?: string,
  attrs?: Record<string, string>
): () => void {
  const apply = (): void => {
    const els = target ? find(root, target) : [root]
    for (const el of els) {
      const name = target ? 'data-ds-force' : 'data-ds-force-all'
      if (states && el.getAttribute(name) !== states) el.setAttribute(name, states)
      for (const [k, v] of Object.entries(attrs ?? {}))
        if (el.getAttribute(k) !== v) el.setAttribute(k, v)
    }
  }
  apply()
  const mo = new MutationObserver(apply)
  mo.observe(root, { childList: true, subtree: true })
  return () => mo.disconnect()
}
