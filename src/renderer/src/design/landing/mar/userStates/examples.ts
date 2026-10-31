import { hostActions } from '../../useProto'
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
}

export const EXAMPLES: Example[] = [
  {
    label: 'Remove a background',
    kind: 'Image',
    runs: '~10 s',
    src: mock('start-remove-a-background')
  },
  {
    label: 'Turn a photo into video',
    kind: 'Video',
    runs: '~1 min',
    // A real ComfyUI output: the What's new banner's loops sit on this page too.
    src: mock('clip-eye'),
    video: './install-showcase-scene/Assets/eye.webm'
  },
  {
    label: 'Reshoot your product',
    kind: 'Image',
    runs: '~20 s',
    src: mock('start-reshoot-your-product')
  },
  { label: 'Upscale to 4K', kind: 'Image', runs: '~15 s', src: mock('start-upscale-to-4k') },
  {
    label: 'Relight a portrait',
    kind: 'Image',
    runs: '~20 s',
    src: mock('start-relight-a-portrait')
  }
]

/** Picking an example opens it in ComfyUI on Comfy Cloud (a new tab with
 *  its workflow, asking to sign in if needed), never the prompt or the
 *  agent: an example is a workflow to run. */
export function runExample(x: Example): void {
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
