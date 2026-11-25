import { computed } from 'vue'
import { proto } from '../../useProto'
import { appsProto } from '../../appFlow'
import { envById } from '../../parts/env/env'
import { can } from '../../milestones'
import { syncing } from './syncPrevious'

/**
 * A build's page navigation: the title bar's breadcrumb says where you are
 * (Home › Builds › the build), so the page drops its back link; the header
 * is one compact row with its meta inline; the sections are the tab group
 * every other page uses, each with content or an empty state.
 */

const SETTINGS = '/settings'

/** The build a page belongs to: its own page or its Settings page. */
export const buildIdOf = (page: string): string =>
  page.startsWith('environment:')
    ? page.slice('environment:'.length).replace(new RegExp(`${SETTINGS}$`), '')
    : ''

/** A build's Settings page is on view (syncPrevious.ts). */
export const onBuildSettings = computed(() => syncing.value && proto.page.endsWith(SETTINGS))

/** The build whose page is on view in the app shell, if any. */
export const buildOnView = computed(() => {
  if (proto.activeTab !== 'home' || appsProto.front) return undefined
  return proto.page.startsWith('environment:') ? envById(buildIdOf(proto.page)) : undefined
})

const onBuilds = computed(
  () =>
    proto.activeTab === 'home' &&
    !appsProto.front &&
    (proto.page === 'environments' || proto.page === 'instances')
)

/** What the title bar's breadcrumb shows after its first crumb. From
 *  Milestone 4 that is Home: on the Builds list, Builds; on a build's page,
 *  Builds (back to the list), then the build. Before Home the first crumb
 *  is Builds itself, so only the build follows. */
export const buildTrail = computed<
  { label: string; page?: string; kind?: 'local' | 'cloud' }[] | undefined
>(() => {
  const home = can.value.home
  if (onBuilds.value) return home ? [{ label: 'Builds' }] : undefined
  const env = buildOnView.value
  if (!env) return undefined
  const kind = env.kind === 'cloud' ? ('cloud' as const) : ('local' as const)
  return [
    ...(home ? [{ label: 'Builds', page: 'environments' }] : []),
    ...(onBuildSettings.value
      ? [{ label: env.name, page: `environment:${env.id}` }, { label: 'Settings' }]
      : [{ label: env.name, kind }])
  ]
})
