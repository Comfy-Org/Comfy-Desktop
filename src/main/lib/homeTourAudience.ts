import * as settings from '../settings'

export function recordHomeTourAudience(launchedBefore: boolean): void {
  if (settings.get('homeTourAudience') !== undefined) return
  const returningUser = launchedBefore || settings.get('firstUseCompleted') === true
  settings.set('homeTourAudience', returningUser ? 'updated' : 'new')
}
