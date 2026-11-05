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
  src: string
  video?: string
  /** The app it opens once apps are in (EXAMPLE_APPS). */
  app: string
}

export const EXAMPLES: Example[] = [
  {
    label: 'Remove a background',
    app: 'e-background',
    kind: 'Image',
    runs: '~10 s',
    src: mock('start-remove-a-background')
  },
  {
    label: 'Turn a photo into video',
    app: 'e-video',
    kind: 'Video',
    runs: '~1 min',
    // A real ComfyUI output: the What's new banner's loops sit on this page too.
    src: mock('clip-eye'),
    video: './install-showcase-scene/Assets/eye.webm'
  },
  {
    label: 'Reshoot your product',
    app: 'e-reshoot',
    kind: 'Image',
    runs: '~20 s',
    src: mock('start-reshoot-your-product')
  },
  {
    label: 'Upscale to 4K',
    app: 'e-upscale',
    kind: 'Image',
    runs: '~15 s',
    src: mock('start-upscale-to-4k')
  },
  {
    label: 'Relight a portrait',
    app: 'e-relight',
    kind: 'Image',
    runs: '~20 s',
    src: mock('start-relight-a-portrait')
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
