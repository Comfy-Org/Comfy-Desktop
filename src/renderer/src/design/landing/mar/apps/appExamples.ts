import { reactive } from 'vue'
import { EXAMPLES } from '../userStates/examples'
import { mock } from '../assets/mock'

/**
 * Every example of every app, from Milestone 2: what went in, what came out
 * and the words it ran with. Apps › Examples lists them all, whatever app
 * made them; an app's page lists its own, to start from one like a
 * template. Home's examples come first, each as its app's lead example,
 * with the same picture.
 */
export interface AppExample {
  id: string
  app: string
  title: string
  kind: 'Image' | 'Video'
  src: string
  after: string
  /** The words it ran with, filled into the app's text input. */
  prompt?: string
}

const own = (id: string, app: string, title: string, prompt: string): AppExample => ({
  id,
  app,
  title,
  kind: 'Image',
  src: mock(id),
  after: mock(`${id}-after`),
  prompt
})

export const APP_EXAMPLES: AppExample[] = [
  ...EXAMPLES.map((x) => ({
    id: `home-${x.app}`,
    app: x.app,
    title: x.does,
    kind: x.kind,
    src: x.src,
    after: x.after,
    prompt:
      x.app === 's-cine' ? 'A woman on a rooftop at night, city lights, slow push in' : undefined
  })),
  own('ex-cine-diner', 's-cine', 'Night diner, neon noir', 'Neon noir, rain on the window, 35 mm'),
  own(
    'ex-cine-beach',
    's-cine',
    'Golden hour on the beach',
    'Golden hour, sun flare, warm film grain'
  ),
  own(
    'ex-relight-room',
    'e-relight',
    'Daylight room to lamplight',
    'Night, one warm lamp, blue window'
  ),
  own(
    'ex-relight-cafe',
    'e-relight',
    'A café after the rain',
    'Night after rain, neon reflections'
  ),
  own(
    'ex-reshoot-sneaker',
    'e-reshoot',
    'Sneaker on volcanic rock',
    'Wet black rock, mist, rim light'
  ),
  own(
    'ex-reshoot-perfume',
    'e-reshoot',
    'Perfume with peonies',
    'Marble pedestal, peonies, morning light'
  )
]

export const examplesOf = (app: string): AppExample[] => APP_EXAMPLES.filter((x) => x.app === app)

/** Which example an app opens on: the one picked in Apps › Examples, else
 *  its lead one. */
export const openOn = reactive<Record<string, string>>({})
