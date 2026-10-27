import { reactive, watch } from 'vue'

/**
 * The visual direction and theme the prototype is drawn in (Prototype menu).
 * Both live on <html> as `data-ds-direction` and `data-ds-theme`, so
 * overlays portalled to <body> follow too. Each direction is a stylesheet
 * that overrides token values (ui/looks/), so a whole look changes in one
 * file and is thrown away by deleting it. Shared through localStorage so the
 * title bar and its popups (separate renderers) follow, live.
 */

export const DIRECTIONS = [
  { value: 'original', label: 'Original' },
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
  { value: 'c', label: 'C' }
] as const

export const THEMES = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' }
] as const

export type Direction = (typeof DIRECTIONS)[number]['value']
export type Theme = (typeof THEMES)[number]['value']

interface Look {
  direction: Direction
  theme: Theme
}

const LOOK_KEY = 'comfy.design.look'
const DEFAULT_LOOK: Look = { direction: 'original', theme: 'dark' }

function isDirection(v: unknown): v is Direction {
  return DIRECTIONS.some((d) => d.value === v)
}

function isTheme(v: unknown): v is Theme {
  return THEMES.some((t) => t.value === v)
}

function saved(): Partial<Look> {
  try {
    return JSON.parse(localStorage.getItem(LOOK_KEY) ?? '{}')
  } catch {
    return {}
  }
}

/** URL overrides storage (`?direction=a&theme=light`), for screenshots and
 *  links that should open in a given look. */
function load(): Look {
  const url = new URLSearchParams(location.search)
  const stored = saved()
  const direction = url.get('direction') ?? stored.direction
  const theme = url.get('theme') ?? stored.theme
  return {
    direction: isDirection(direction) ? direction : DEFAULT_LOOK.direction,
    theme: isTheme(theme) ? theme : DEFAULT_LOOK.theme
  }
}

export const look = reactive<Look>(load())

watch(
  () => ({ direction: look.direction, theme: look.theme }),
  (l) => {
    document.documentElement.dataset.dsDirection = l.direction
    document.documentElement.dataset.dsTheme = l.theme
    localStorage.setItem(LOOK_KEY, JSON.stringify(l))
  },
  { immediate: true }
)

window.addEventListener('storage', (e) => {
  if (e.key === LOOK_KEY) Object.assign(look, load())
})
