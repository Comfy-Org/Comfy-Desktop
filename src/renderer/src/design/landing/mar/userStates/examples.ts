import { hostActions } from '../../useProto'
import { openAppUrl } from '../../appFlow'
import { can } from '../../milestones'
import { INSTANCES } from '../../mock'
import { mock } from '../assets/mock'

/**
 * The examples a first-time user can run in a click (Start from an
 * example). `kind` and `runs` fill the line under the title, where a
 * Recently used card says when you last opened it: an example has never
 * run, so it says how long one run takes ("~20 s"), with no "about".
 * Once run, it is your work and shows up in Recently used.
 */
export interface Example {
  label: string
  kind: 'Image' | 'Video'
  runs: string
  /** What goes in. */
  src: string
  /** What comes out: the front card of the arc sweeps between the two. */
  after: string
  /** Where each picture sits in a tall card (object-position x), when its
   *  subject is off centre. */
  focus?: [string, string]
  video?: string
  /** The app it opens once apps are in. */
  app: string
}

export const EXAMPLES: Example[] = [
  {
    label: 'Re-shoot a video',
    app: 's-reshoot',
    kind: 'Video',
    runs: '~1 min',
    src: mock('app-reshoot-a-video'),
    after: mock('app-reshoot-a-video-after'),
    focus: ['50%', '85%']
  },
  {
    label: 'Relight a scene',
    app: 'e-relight',
    kind: 'Image',
    runs: '~20 s',
    src: mock('app-relight-a-scene'),
    after: mock('app-relight-a-scene-after'),
    focus: ['80%', '80%']
  },
  {
    label: 'Cinematic Studio',
    app: 's-cine',
    kind: 'Image',
    runs: '~20 s',
    src: mock('app-cinematic-studio'),
    after: mock('app-cinematic-studio-after')
  },
  {
    label: 'Reshoot your product',
    app: 'e-reshoot',
    kind: 'Image',
    runs: '~20 s',
    src: mock('app-reshoot-your-product'),
    after: mock('app-reshoot-your-product-after')
  },
  {
    label: 'Openjutsu',
    app: 's-jutsu',
    kind: 'Video',
    runs: '~1 min',
    src: mock('app-openjutsu'),
    after: mock('app-openjutsu-after'),
    focus: ['45%', '50%']
  }
]

/** Picking an example opens it as an app, ready to run. Before apps are in,
 *  it opens in ComfyUI on Comfy Cloud (a new tab with its workflow, asking to
 *  sign in if needed). Never the prompt or the agent. */
export function runExample(x: Example): void {
  if (can.value.exploreApps) return openAppUrl(x.app)
  hostActions.launch(INSTANCES[0]!, x.label)
}

export const reducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Plays (or stops and rewinds) the loop inside a card, if it has one. */
export function playLoop(el: Element | null, on: boolean): void {
  const video = el?.querySelector('video')
  if (!video) return
  if (on && !reducedMotion()) void video.play().catch(() => {})
  else {
    video.pause()
    video.currentTime = 0
  }
}
