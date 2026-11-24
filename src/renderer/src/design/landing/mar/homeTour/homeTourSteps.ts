export type HomeTourAudience = 'new' | 'updated'

export type HomeTourAnchor =
  | 'home-builds'
  | 'cloud-build'
  | 'local-build'
  | 'all-builds'
  | 'new-build'
  | 'apps-carousel'
  | 'apps'
  | 'assets'

export interface HomeTourStep {
  anchor: HomeTourAnchor
  side: 'top' | 'right'
  align: 'start' | 'center'
  title: string
  body: string
}

const COPY = {
  buildsIntro: {
    title: 'Builds run ComfyUI',
    body: 'A build is a copy of ComfyUI that you can open. Most people need only one.'
  },
  buildsRenamed: {
    title: 'Instances are now builds',
    body: 'Your ComfyUI instances are now called builds. They keep the same models and settings.'
  },
  cloudBuild: {
    title: 'Comfy Cloud',
    body: 'Comfy Cloud needs no setup. It runs on GPUs in the cloud, so it works on any computer.'
  },
  localBuild: {
    title: 'Local build',
    body: 'A local build runs on this computer, for free. Your files stay on this computer.'
  },
  allBuilds: { title: 'All your builds', body: 'Click here to see all your builds.' },
  newBuild: { title: 'New build', body: 'Click + to start a new build.' },
  newApps: {
    title: 'New: Apps',
    body: 'Apps are ready-made tools. Pick one, add your image or text, and run it.'
  },
  allApps: { title: 'All apps', body: 'Find all apps here.' },
  assets: { title: 'Assets', body: 'Everything you generate is saved here.' }
} satisfies Record<string, { title: string; body: string }>

export const HOME_TOUR_TEXT = {
  progress: (current: number, total: number): string => `${current} of ${total}`,
  next: 'Next',
  back: 'Back',
  skip: 'Skip',
  done: 'Done',
  replayHint: 'Find the tour again in the bell menu.'
}

function step(
  anchor: HomeTourAnchor,
  copy: keyof typeof COPY,
  side: HomeTourStep['side'] = 'right',
  align: HomeTourStep['align'] = 'start'
): HomeTourStep {
  return { anchor, side, align, ...COPY[copy] }
}

const AFTER_BUILDS: HomeTourStep[] = [
  step('all-builds', 'allBuilds'),
  step('new-build', 'newBuild'),
  step('apps-carousel', 'newApps', 'right', 'center'),
  step('apps', 'allApps'),
  step('assets', 'assets')
]

export const HOME_TOUR_STEPS: Record<HomeTourAudience, HomeTourStep[]> = {
  new: [
    step('home-builds', 'buildsIntro', 'top'),
    step('cloud-build', 'cloudBuild', 'top'),
    step('local-build', 'localBuild', 'top'),
    ...AFTER_BUILDS
  ],
  updated: [step('home-builds', 'buildsRenamed', 'top'), ...AFTER_BUILDS]
}

function isShown(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return false
  if (el.closest('[inert]')) return false
  return el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
}

export function findHomeTourAnchor(anchor: HomeTourAnchor): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-home-tour="${anchor}"]`)) {
    if (isShown(el)) return el
  }
  return null
}
