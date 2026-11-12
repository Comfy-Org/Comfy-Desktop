import { ref } from 'vue'
import { go, type Page } from '../../useProto'

/** The tabs of a build's page (MarBuildPage): Desktop's in the Builds
 *  milestone, the later ones after it. */
export type BuildTab =
  | 'overview'
  | 'update'
  | 'args'
  | 'snapshots'
  | 'storage'
  | 'terminal'
  | 'about'
  | 'settings'
  | 'deployments'

/** Desktop's tabs: all of them for a build on this computer, Storage and
 *  About for Cloud, About for Remote. From Milestone 3 (`combined`), About
 *  and Update are one Overview tab, first, and Storage, named Assets &
 *  Models, comes second. */
export function desktopTabs(
  own: boolean,
  remote: boolean,
  dot = false,
  combined = false
): { value: BuildTab; label: string; dot?: boolean }[] {
  if (combined) {
    const overview = { value: 'about' as BuildTab, label: 'Overview', dot: own && dot }
    if (remote) return [overview]
    const storage = { value: 'storage' as BuildTab, label: 'Assets & Models' }
    if (!own) return [overview, storage]
    return [
      overview,
      storage,
      { value: 'args', label: 'Startup Args' },
      { value: 'snapshots', label: 'Snapshots' },
      { value: 'terminal', label: 'Terminal' }
    ]
  }
  if (remote) return [{ value: 'about', label: 'About' }]
  if (!own)
    return [
      { value: 'storage', label: 'Storage' },
      { value: 'about', label: 'About' }
    ]
  return [
    { value: 'update', label: 'Update', dot },
    { value: 'args', label: 'Startup Args' },
    { value: 'snapshots', label: 'Snapshots' },
    { value: 'storage', label: 'Storage' },
    { value: 'terminal', label: 'Terminal' },
    { value: 'about', label: 'About' }
  ]
}

/** Update lives in Overview once the two are one tab. */
export function tabAsked(asked: BuildTab | '', combined: boolean): BuildTab | '' {
  return combined && asked === 'update' ? 'about' : asked
}

/** The tab the next build page opens on; it reads it once and clears it. */
export const nextBuildTab = ref<BuildTab | ''>('')

/** Open a build's page, on one of its tabs. */
export function openBuild(id: string, tab?: BuildTab): void {
  nextBuildTab.value = tab ?? ''
  go(`environment:${id}` as Page)
}

/** Open a build's Settings page (MarBuildSettingsPage), on one of its tabs. */
export function openBuildSettings(id: string, tab?: BuildTab): void {
  nextBuildTab.value = tab ?? ''
  go(`environment:${id}/settings` as Page)
}
