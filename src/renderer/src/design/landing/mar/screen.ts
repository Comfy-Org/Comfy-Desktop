import { reactive, watch } from 'vue'

/**
 * Screen simulator (UI Playground › Screen): lays the prototype out at a
 * screen size people really use, then scales it down to fit this window,
 * so one window can check them all. Zoom stands in for Windows display
 * scaling and Ctrl/Cmd + in the app: the layout gets fewer CSS pixels and
 * everything draws bigger. Sizes are CSS pixels, what the layout sees.
 */

export interface ScreenPreset {
  id: string
  label: string
  /** Who has it, in a few words. */
  note: string
  w: number
  h: number
}

export const SCREENS: ScreenPreset[] = [
  { id: 'fit', label: 'This window', note: 'This window', w: 0, h: 0 },
  { id: 'min', label: '1024 × 640', note: 'Smallest app window', w: 1024, h: 640 },
  { id: 'win-hd', label: '1366 × 768', note: 'Budget Windows laptop', w: 1366, h: 768 },
  { id: 'mba', label: '1440 × 900', note: 'MacBook Air 13″', w: 1440, h: 900 },
  { id: 'mbp14', label: '1512 × 982', note: 'MacBook Pro 14″', w: 1512, h: 982 },
  { id: 'win-125', label: '1536 × 864', note: 'Windows at 125%', w: 1536, h: 864 },
  { id: 'fhd', label: '1920 × 1080', note: '1080p monitor', w: 1920, h: 1080 },
  { id: 'qhd', label: '2560 × 1440', note: '1440p or 4K at 150%', w: 2560, h: 1440 }
]

export const ZOOMS = [0.9, 1, 1.1, 1.25]

/** How the panel renders colour. A rough stand-in for the screens people
 *  look at us on, applied as a filter over the whole app. */
export const DISPLAYS: { id: string; label: string; note: string; filter: string }[] = [
  { id: 'true', label: 'Accurate', note: 'Calibrated screen', filter: '' },
  {
    id: 'washed',
    label: 'Washed out',
    note: 'Cheap laptop panel',
    filter: 'contrast(0.82) brightness(1.1)'
  },
  {
    id: 'punchy',
    label: 'Punchy',
    note: 'Glossy or OLED',
    filter: 'contrast(1.18) saturate(1.2)'
  },
  { id: 'dim', label: 'Dim', note: 'Brightness turned down', filter: 'brightness(0.75)' },
  {
    id: 'warm',
    label: 'Night Shift',
    note: 'Warm night mode',
    filter: 'sepia(0.3) saturate(1.15) hue-rotate(-12deg)'
  }
]

const KEY = 'comfy.design.mar.screen'

function load(): { id: string; zoom: number; display: string } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return {
      id: SCREENS.some((s) => s.id === v.id) ? v.id : 'fit',
      zoom: ZOOMS.includes(v.zoom) ? v.zoom : 1,
      display: DISPLAYS.some((d) => d.id === v.display) ? v.display : 'true'
    }
  } catch {
    return { id: 'fit', zoom: 1, display: 'true' }
  }
}

export const screen = reactive(load())

const PAD = 24
const LABEL = 28

function apply(): void {
  const root = document.documentElement
  const filter = DISPLAYS.find((d) => d.id === screen.display)?.filter
  if (filter) root.style.setProperty('--scr-filter', filter)
  else root.style.removeProperty('--scr-filter')
  const preset = SCREENS.find((s) => s.id === screen.id)
  if (!preset?.w && screen.zoom === 1) {
    delete root.dataset.marScreen
    for (const p of ['--scr-w', '--scr-h', '--scr-s', '--scr-x', '--scr-y', '--scr-label'])
      root.style.removeProperty(p)
    return
  }
  // No preset: this window's size, only zoomed.
  const W = preset?.w || window.innerWidth
  const H = preset?.h || window.innerHeight
  const framed = Boolean(preset?.w)
  const room = {
    w: window.innerWidth - (framed ? PAD * 2 : 0),
    h: window.innerHeight - (framed ? PAD * 2 + LABEL : 0)
  }
  const fit = Math.min(room.w / W, room.h / H, 1)
  root.dataset.marScreen = framed ? 'framed' : 'zoom'
  root.style.setProperty('--scr-w', `${W / screen.zoom}px`)
  root.style.setProperty('--scr-h', `${H / screen.zoom}px`)
  root.style.setProperty('--scr-s', String(fit * screen.zoom))
  root.style.setProperty('--scr-x', `${(window.innerWidth - W * fit) / 2}px`)
  root.style.setProperty('--scr-y', `${framed ? PAD + LABEL + (room.h - H * fit) / 2 : 0}px`)
  const zoom = screen.zoom === 1 ? '' : ` · zoom ${Math.round(screen.zoom * 100)}%`
  const scale = fit < 1 ? ` · shown at ${Math.round(fit * 100)}%` : ''
  root.style.setProperty(
    '--scr-label',
    JSON.stringify(framed ? `${preset!.label} · ${preset!.note}${zoom}${scale}` : '')
  )
}

watch(
  () => ({ ...screen }),
  (v) => {
    apply()
    try {
      localStorage.setItem(KEY, JSON.stringify(v))
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  },
  { immediate: true }
)
window.addEventListener('resize', apply)
