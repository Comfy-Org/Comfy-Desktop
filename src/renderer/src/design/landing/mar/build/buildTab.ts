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

/** Desktop's tabs (ComfyUISettingsContent.vue): Overview (the facts as
 *  cards, Comfy-Desktop#2062, in place of Update and About), Folders
 *  (#2198 moved it second, #2217 named it), Startup arguments (#2179),
 *  Snapshots, Terminal. Cloud: Overview and Storage (its browser cache,
 *  not folders). Remote: Overview. The update dot sits on Overview. */
export function desktopTabs(
  own: boolean,
  remote: boolean,
  dot = false
): { value: BuildTab; label: string; dot?: boolean }[] {
  if (remote) return [{ value: 'overview', label: 'Overview' }]
  if (!own)
    return [
      { value: 'overview', label: 'Overview' },
      { value: 'storage', label: 'Storage' }
    ]
  return [
    { value: 'overview', label: 'Overview', dot },
    { value: 'storage', label: 'Folders' },
    { value: 'args', label: 'Startup arguments' },
    { value: 'snapshots', label: 'Snapshots' },
    { value: 'terminal', label: 'Terminal' }
  ]
}

/** Update and About are Overview now: a link to either lands there. */
export const tabOf = (t: BuildTab | ''): BuildTab | '' =>
  t === 'update' || t === 'about' ? 'overview' : t

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
