import { reactive, watch } from 'vue'

/**
 * The 20 UI proposals from Figma ("UI proposals · 20", page 115:1527),
 * brought into Mar's proposal as switches (UI Playground › Proposals ·
 * 20). Each one swaps or adds one piece (the Home layouts were dropped).
 * Left out on purpose: 09 Dock, 17 Workspace switcher, 19 Agent split
 * and the Up next list of 16; the Home prompt gets no model or aspect
 * chips.
 */
export const P20 = {
  recent: [
    { value: 'cards', label: 'Cards' },
    { value: 'filmstrip', label: '04 · Filmstrip' },
    { value: 'table', label: '13 · Library table' }
  ],
  spaces: [
    { value: 'plain', label: 'Plain' },
    { value: 'gradient', label: '07 · Gradient spaces' }
  ],
  news: [
    { value: 'banner', label: 'Banner' },
    { value: 'spotlight', label: '16 · Spotlight' }
  ],
  builds: [
    { value: 'off', label: 'Off' },
    { value: 'health', label: '18 · Build health' }
  ],
  pulse: [{ value: 'off', label: 'Off' }],
  panel: [
    { value: 'none', label: 'None' },
    { value: 'queue', label: '06 · Queue' },
    { value: 'inspector', label: '14 · Inspector' }
  ],
  density: [
    { value: 'default', label: 'Default' },
    { value: 'dense', label: '15 · Dense pro' }
  ],
  rail: [
    { value: 'plain', label: 'Icons' },
    { value: 'flyout', label: '01 · Studio rail' }
  ]
} as const

type Knob = keyof typeof P20
export type P20State = { [K in Knob]: (typeof P20)[K][number]['value'] }

const DEFAULTS: P20State = {
  recent: 'cards',
  spaces: 'plain',
  news: 'banner',
  builds: 'off',
  pulse: 'off',
  panel: 'none',
  density: 'default',
  rail: 'plain'
}

const KEY = 'comfy.design.mar.p20'

function load(): P20State {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<P20State>
    const out = { ...DEFAULTS }
    for (const k of Object.keys(DEFAULTS) as Knob[]) {
      const ok = (P20[k] as readonly { value: string }[]).some((o) => o.value === v[k])
      if (ok) (out as Record<string, string>)[k] = v[k] as string
    }
    return out
  } catch {
    return { ...DEFAULTS }
  }
}

export const p20 = reactive<P20State>(load())

watch(
  () => ({ ...p20 }),
  (v) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(v))
    } catch {
      // Storage blocked: the picks last for this window only.
    }
    const d = document.documentElement.dataset
    d.marDensity = v.density
    d.marPanel = v.panel
  },
  { immediate: true }
)
