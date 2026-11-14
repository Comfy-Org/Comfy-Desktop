export const CLICK_PATIENCE_MS = 5000
export const PRESS_PATIENCE_MS = 1000
const RE_AIM_PAUSE_MS = 50

export interface ClickPoint {
  x: number
  y: number
}

export type AimOutcome = ClickPoint | 'missing' | 'blocked'
export type PressOutcome = 'landed' | 'missed' | 'unseen'
export type ClickAttempt = 'clicked' | 'missed' | 'missing' | 'blocked'
export type ClickOutcome = 'clicked' | 'missing' | 'blocked' | 'moving'

export const PRESS_OUTCOME_EXPRESSION = 'window.__e2ePressWatch.outcome'

export function aimAndWatchPressScript(elementExpression: string, patienceMs: number): string {
  return `(async () => {
    const watchPress = (el) => {
      window.__e2ePressWatch?.stop()
      const gesture = new AbortController()
      let landed = null
      let settle = () => {}
      const outcome = new Promise(resolve => { settle = resolve })
      const finish = (result) => { gesture.abort(); settle(result) }
      const swallow = (event) => { event.preventDefault(); event.stopImmediatePropagation() }
      const onPress = (event) => {
        if (landed === null) landed = el.contains(event.target)
        if (!landed) swallow(event)
      }
      const onRelease = (event) => {
        if (!landed) swallow(event)
        setTimeout(() => finish(landed ? 'landed' : 'missed'))
      }
      const onClick = (event) => {
        if (!landed) swallow(event)
      }
      const listen = (type, handler) =>
        window.addEventListener(type, handler, { capture: true, signal: gesture.signal })
      listen('pointerdown', onPress)
      listen('mousedown', onPress)
      listen('pointerup', onRelease)
      listen('mouseup', onRelease)
      listen('click', onClick)
      const expiry = setTimeout(() => finish('unseen'), ${PRESS_PATIENCE_MS})
      gesture.signal.addEventListener('abort', () => clearTimeout(expiry))
      window.__e2ePressWatch = { outcome, stop: () => finish('unseen') }
    }
    const deadline = performance.now() + ${patienceMs}
    for (;;) {
      const el = ${elementExpression}
      if (!el) return 'missing'
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
      const rect = el.getBoundingClientRect()
      const left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right)
      const top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom)
      const x = Math.floor((left + right) / 2), y = Math.floor((top + bottom) / 2)
      const hit = document.elementFromPoint(x, y)
      if (right > left && bottom > top && hit && el.contains(hit)) {
        watchPress(el)
        return { x, y }
      }
      if (performance.now() >= deadline) return 'blocked'
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  })()`
}

export async function clickUntilLanded(
  attempt: (patienceMs: number) => Promise<ClickAttempt>,
  patienceMs: number = CLICK_PATIENCE_MS
): Promise<ClickOutcome> {
  const deadline = Date.now() + patienceMs
  for (;;) {
    const outcome = await attempt(Math.max(0, deadline - Date.now()))
    if (outcome !== 'missed') return outcome
    if (Date.now() >= deadline) return 'moving'
    await new Promise((resolve) => setTimeout(resolve, RE_AIM_PAUSE_MS))
  }
}
