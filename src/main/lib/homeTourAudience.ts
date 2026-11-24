import * as settings from '../settings'

export function recordHomeTourAudience(launchedBefore: boolean): void {
  if (settings.get('homeTourAudience') !== undefined) return
  const returningUser = launchedBefore || settings.get('firstUseCompleted') === true
  try {
    settings.set('homeTourAudience', returningUser ? 'updated' : 'new')
  } catch (err) {
    console.warn('[home-tour] could not save the tour audience:', err)
  }
}
