import { computed, ref, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'
import { refDebounced } from '@vueuse/core'
import { useSessionStore } from '../../stores/sessionStore'
import { useAuthStore } from '../../stores/authStore'
import type {
  InstallContentsFacet,
  InstallContentsPage,
  InstallContentsRequest,
  Installation
} from '../../types/ipc'

type InstallContentsLister<T> = (
  installationId: string,
  request: InstallContentsRequest
) => Promise<InstallContentsPage<T>>

/**
 * One of a build's listings (workflows, models, nodes, assets), paged from
 * main. Re-queries when the search, sort or filter changes; refreshes when the
 * build stops (its files settle) and, for Comfy Cloud, when the account or its
 * workspace changes. A response to an older request is dropped, so a slow
 * page can never overwrite a newer one. `facets` is the filter row, from the
 * latest first page.
 */
export function useInstallContents<T>(
  lister: InstallContentsLister<T>,
  installation: () => Installation,
  options: {
    query?: Ref<string>
    sort?: Ref<'modified' | 'name'>
    filter?: Ref<string | undefined>
  } = {}
) {
  const sessionStore = useSessionStore()
  const authStore = useAuthStore()
  const query = options.query ? refDebounced(options.query, 200) : ref('')

  const items = shallowRef<T[]>([])
  const managed = ref(false)
  const facets = shallowRef<InstallContentsFacet[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const signedOut = ref(false)
  const nextCursor = ref<string | null>(null)
  const hasMore = computed(() => nextCursor.value !== null)

  let generation = 0

  async function load(cursor?: string): Promise<void> {
    const mine = ++generation
    loading.value = true
    const page = await lister(installation().id, {
      query: query.value.trim() || undefined,
      sort: options.sort?.value,
      filter: options.filter?.value,
      cursor
    }).catch(
      (err: unknown): InstallContentsPage<T> => ({
        ok: false,
        message: err instanceof Error ? err.message : String(err)
      })
    )
    if (mine !== generation) return
    loading.value = false
    if (!page.ok) {
      error.value = page.signedOut ? null : page.message
      signedOut.value = page.signedOut === true
      if (!cursor) items.value = []
      nextCursor.value = null
      return
    }
    error.value = null
    signedOut.value = false
    items.value = cursor ? [...items.value, ...page.items] : page.items
    managed.value = page.managed === true
    if (!cursor) facets.value = page.facets ?? []
    nextCursor.value = page.nextCursor
  }

  function refresh(): Promise<void> {
    return load()
  }

  function loadMore(): Promise<void> {
    return nextCursor.value ? load(nextCursor.value) : Promise.resolve()
  }

  watch(
    [() => installation().id, query, () => options.sort?.value, () => options.filter?.value],
    () => void refresh(),
    { immediate: true }
  )
  watch(
    () => sessionStore.isRunning(installation().id),
    (running, wasRunning) => {
      if (wasRunning && !running) void refresh()
    }
  )
  watch(
    () => [authStore.isSignedIn, authStore.status.workspaceId] as const,
    () => {
      if (installation().sourceCategory === 'cloud') void refresh()
    }
  )

  return {
    items,
    managed,
    facets,
    loading,
    error,
    signedOut,
    hasMore,
    refresh,
    loadMore
  }
}
