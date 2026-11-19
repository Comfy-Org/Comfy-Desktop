import { ref, watch, type Ref } from 'vue'
import { liveTheme, type Mode } from './model'
import { state } from './usePlayground'

/**
 * The Theme playground on production ComfyUI (Comfy Cloud). Cloud can't
 * be framed with a session, so the playground opens it in its own tab
 * and sends the tokens there; the receiver below, run once in that tab
 * (bookmarklet or console), paints them the way the palette does:
 * theme.css names on <html> and litegraph's canvas fill.
 *
 * Dark and light switch Cloud's own Comfy.ColorPalette setting; Stop, or
 * closing the playground, puts the palette that was there back.
 */
export const CLOUD = 'https://cloud.comfy.org/'
const TYPE = 'comfy-theme-playground'

export const RECEIVER = `(() => {
  const T = '${TYPE}'
  if (window.__themePlayground) return window.__themePlayground.hello()
  if (!window.app || !window.app.canvas || !window.LiteGraph)
    return alert('Open a workflow in ComfyUI first, then run the Theme playground again.')
  const trusted = (o) =>
    /^https?:\\/\\/(localhost|127\\.0\\.0\\.1)(:\\d+)?$/.test(o) || o === 'https://one-comfy-ds.vercel.app'
  const setting = window.app.extensionManager && window.app.extensionManager.setting
  const original = setting && setting.get('Comfy.ColorPalette')
  const style = document.createElement('style')
  style.id = 'theme-playground'
  document.head.append(style)
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const palette = async (id) => {
    if (!setting || !id || setting.get('Comfy.ColorPalette') === id) return
    await setting.set('Comfy.ColorPalette', id)
    await wait(400)
  }
  const apply = async (m) => {
    if (m.off) {
      style.textContent = ''
      await palette(original)
      return
    }
    await palette(m.mode === 'light' ? 'light' : 'dark')
    style.textContent = ':root { ' + Object.entries(m.vars)
      .map(([k, v]) => k + ': ' + v + ' !important').join('; ') + ' }'
    for (const [k, v] of Object.entries(m.litegraph || {})) {
      window.LiteGraph[k] = v
      if (k === 'CLEAR_BACKGROUND_COLOR') window.app.canvas.clear_background_color = v
    }
    window.app.canvas.setDirty(true, true)
  }
  let queue = Promise.resolve()
  addEventListener('message', (e) => {
    if (!trusted(e.origin) || !e.data || e.data.type !== T) return
    queue = queue.then(() => apply(e.data)).catch(console.error)
  })
  const hello = () => window.opener && window.opener.postMessage({ type: T + ':ready' }, '*')
  window.__themePlayground = { hello }
  hello()
})()`

export const BOOKMARKLET = `javascript:${encodeURIComponent(RECEIVER)}`

export type CloudStatus = 'closed' | 'waiting' | 'connected' | 'paused'

/** The Cloud tab, its connection, and the tokens it gets on every change. */
export function useCloud(mode: Ref<Mode>): {
  status: Ref<CloudStatus>
  open: () => void
  stop: () => void
  resume: () => void
} {
  const status = ref<CloudStatus>('closed')
  let win: Window | null = null
  const origin = new URL(CLOUD).origin
  const send = (): void => {
    if (status.value !== 'connected' || !win || win.closed) return
    win.postMessage({ type: TYPE, mode: mode.value, ...liveTheme(state.value, mode.value) }, origin)
  }
  window.addEventListener('message', (e) => {
    if (e.origin !== origin || e.data?.type !== `${TYPE}:ready` || e.source !== win) return
    status.value = 'connected'
    send()
  })
  // A closed tab is noticed on the next look.
  setInterval(() => {
    if (win?.closed) {
      win = null
      status.value = 'closed'
    }
  }, 1000)
  window.addEventListener('beforeunload', () => stop())
  watch([state, mode], send, { deep: true })
  function open(): void {
    if (win && !win.closed) return void win.focus()
    win = window.open(CLOUD, 'comfy-theme-playground')
    status.value = win ? 'waiting' : 'closed'
  }
  function stop(): void {
    if (win && !win.closed && status.value === 'connected')
      win.postMessage({ type: TYPE, off: true }, origin)
    if (status.value === 'connected') status.value = 'paused'
  }
  function resume(): void {
    if (status.value !== 'paused') return
    status.value = 'connected'
    send()
  }
  return { status, open, stop, resume }
}
