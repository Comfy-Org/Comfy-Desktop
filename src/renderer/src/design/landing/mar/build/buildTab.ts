import { ref } from 'vue'
import { go, type Page } from '../../useProto'

/** The tabs of a build's page (MarBuildPage). */
export type BuildTab = 'overview' | 'snapshots' | 'settings' | 'deployments'

/** The tab the next build page opens on; it reads it once and clears it. */
export const nextBuildTab = ref<BuildTab | ''>('')

/** Open a build's page, on one of its tabs. */
export function openBuild(id: string, tab?: BuildTab): void {
  nextBuildTab.value = tab ?? ''
  go(`environment:${id}` as Page)
}
