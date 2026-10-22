import { onMounted, onUnmounted, ref, type Ref } from 'vue'

/**
 * The launcher's title bar is a breadcrumb: Home › the build in front (its
 * info card on hover) and a chevron to switch builds. In the app the title
 * bar is its own renderer (comfyTitleBar), apart from the launcher page
 * (panel). Both share an origin, so they talk through localStorage: the page
 * publishes what the bar shows (titleBar.ts), the bar sends back what was
 * clicked.
 *
 * This module is the title bar's side and must not import the prototype's
 * state: the bar only renders what the page published.
 */
export const TITLEBAR_STATE_KEY = 'comfy.design.titleBar'
export const TITLEBAR_COMMAND_KEY = 'comfy.design.titleBarCommand'

export interface TitleBarState {
  /** The roadmap milestone the prototype shows (milestones.ts): the chrome
   *  takes the new design from 1, the breadcrumb from 3, and its root is
   *  Home from 4 (Builds before). */
  milestone: number
  /** Home (the launcher) is in front. */
  home: boolean
  /** The build switcher is open (the browser preview's stand-in only; in
   *  the app it's a title-bar popup). */
  menuOpen: boolean
  /** The build in front (installation id), or null on Home. */
  front: { id: string; name: string; kind: 'local' | 'cloud' } | null
  /** Every build the switcher offers, most recently used first: whether
   *  it's open here, its state (how long switching to it takes) and when it
   *  was last used. */
  builds: {
    id: string
    name: string
    kind: 'local' | 'cloud'
    open: boolean
    status: 'open' | 'running' | 'starting' | 'stopped' | 'error'
    lastUsed: string
    /** For its info card: install type, ComfyUI version, where it lives,
     *  and a pending update. */
    source: string
    version?: string
    location?: string
    update?: string
  }[]
  /** The Prototype menu: each switch and its current value. */
  options: {
    key: string
    label: string
    value: string
    options: { value: string; label: string }[]
  }[]
}

export type TitleBarCommand =
  | { type: 'home' }
  /** Toggle the build switcher under the chevron (window px). */
  | { type: 'switcher'; left: number; width: number; bottom: number }
  /** The pointer entered / left the build's name, or it was clicked - its
   *  info card opens on hover (window px). */
  | { type: 'info'; phase: 'enter' | 'leave' | 'click'; left: number; bottom: number }

function read(): TitleBarState | null {
  try {
    return JSON.parse(localStorage.getItem(TITLEBAR_STATE_KEY) ?? 'null')
  } catch {
    return null
  }
}

/** What the launcher page last published; null when it hasn't. */
export function usePublishedTitleBar(): Ref<TitleBarState | null> {
  const state = ref(read())
  const onStorage = (e: StorageEvent): void => {
    if (e.key === TITLEBAR_STATE_KEY) state.value = read()
  }
  onMounted(() => window.addEventListener('storage', onStorage))
  onUnmounted(() => window.removeEventListener('storage', onStorage))
  return state
}

export function sendTitleBarCommand(cmd: TitleBarCommand): void {
  // The timestamp makes every command a change, so it always fires.
  localStorage.setItem(TITLEBAR_COMMAND_KEY, JSON.stringify({ ...cmd, at: Date.now() }))
}
