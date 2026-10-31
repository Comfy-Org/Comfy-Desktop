import { computed, reactive, watch } from 'vue'
import { proto } from '../../useProto'
import { appsProto } from '../../appFlow'
import { envById } from '../../parts/env/env'
import { isMariana } from '../proposal'

/**
 * A build's page navigation (UI Playground › This page › Build navigation).
 * Current: Pablo's page - a back link, the header, underline tabs.
 * Proposed: the title bar's breadcrumb says where you are (Home › Builds ›
 * the build), so the page drops its back link; the header is one compact
 * row with its meta inline; the sections are the New UI tab group, each
 * with content or an empty state. Mar's proposal only.
 */
export type BuildNav = 'current' | 'proposed'

export const BUILD_NAVS: { value: BuildNav; label: string }[] = [
  { value: 'current', label: 'Current' },
  { value: 'proposed', label: 'Proposed' }
]

const KEY = 'comfy.design.mar.buildNav'

export const buildNav = reactive<{ id: BuildNav }>({
  id: (() => {
    try {
      return localStorage.getItem(KEY) === 'proposed' ? 'proposed' : 'current'
    } catch {
      return 'current'
    }
  })()
})

watch(
  () => buildNav.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)

export const buildNavProposed = computed(() => isMariana.value && buildNav.id === 'proposed')

/** The build whose page is on view in the app shell, if any. */
export const buildOnView = computed(() => {
  if (proto.activeTab !== 'home' || appsProto.front) return undefined
  return proto.page.startsWith('environment:')
    ? envById(proto.page.slice('environment:'.length))
    : undefined
})

const onBuilds = computed(
  () =>
    proto.activeTab === 'home' &&
    !appsProto.front &&
    (proto.page === 'environments' || proto.page === 'instances')
)

/** What the title bar's breadcrumb shows after Home while Proposed is on:
 *  on the Builds list, Builds; on a build's page, Builds (back to the
 *  list), then the build. */
export const buildTrail = computed(() => {
  if (!buildNavProposed.value) return undefined
  if (onBuilds.value) return [{ label: 'Builds' }]
  const env = buildOnView.value
  if (!env) return undefined
  return [
    { label: 'Builds', page: 'environments' },
    { label: env.name, kind: env.kind === 'cloud' ? ('cloud' as const) : ('local' as const) }
  ]
})
