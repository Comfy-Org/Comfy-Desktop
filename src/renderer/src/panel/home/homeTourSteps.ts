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
  titleKey: string
  bodyKey: string
}

function step(
  anchor: HomeTourAnchor,
  copy: string,
  side: HomeTourStep['side'] = 'right',
  align: HomeTourStep['align'] = 'start'
): HomeTourStep {
  return {
    anchor,
    side,
    align,
    titleKey: `homeTour.${copy}.title`,
    bodyKey: `homeTour.${copy}.body`
  }
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
