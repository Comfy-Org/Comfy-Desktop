import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope, nextTick, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { useInstallContents } from './useInstallContents'
import { useSessionStore } from '../../stores/sessionStore'
import type { InstallContentsPage, InstallContentsRequest, Installation } from '../../types/ipc'

vi.stubGlobal('window', {
  ...window,
  api: {
    comfybuilder: {
      getAuthStatus: vi.fn().mockResolvedValue({ signedIn: false }),
      onAuthChanged: vi.fn(() => () => {})
    }
  }
})

const inst = { id: 'a', sourceCategory: 'local' } as Installation
const page = (items: string[], nextCursor: string | null = null): InstallContentsPage<string> => ({
  ok: true,
  items,
  nextCursor,
  total: items.length,
  truncated: false
})

function setup(
  lister: (id: string, req: InstallContentsRequest) => Promise<InstallContentsPage<string>>
) {
  const query = ref('')
  const scope = effectScope()
  const contents = scope.run(() => useInstallContents(lister, () => inst, { query }))!
  return { contents, query, scope }
}

describe('useInstallContents', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('loads the first page, then appends the next', async () => {
    const lister = vi
      .fn()
      .mockResolvedValueOnce(page(['a', 'b'], '2'))
      .mockResolvedValueOnce(page(['c']))
    const { contents } = setup(lister)
    await flushPromises()
    expect(contents.items.value).toEqual(['a', 'b'])
    expect(contents.hasMore.value).toBe(true)
    await contents.loadMore()
    expect(lister).toHaveBeenLastCalledWith('a', expect.objectContaining({ cursor: '2' }))
    expect(contents.items.value).toEqual(['a', 'b', 'c'])
    expect(contents.hasMore.value).toBe(false)
  })

  it('keeps the rows shown when a later page fails, so Load more can try again', async () => {
    const lister = vi
      .fn()
      .mockResolvedValueOnce(page(['a'], '2'))
      .mockResolvedValueOnce({ ok: false, message: 'offline' })
    const { contents } = setup(lister)
    await flushPromises()
    await contents.loadMore()
    expect(contents.items.value).toEqual(['a'])
    expect(contents.error.value).toBeNull()
    expect(contents.hasMore.value).toBe(true)
  })

  it('reads on past a page that a filter left empty', async () => {
    const lister = vi
      .fn()
      .mockResolvedValueOnce(page([], '2'))
      .mockResolvedValueOnce(page(['b']))
    const { contents } = setup(lister)
    await flushPromises()
    expect(contents.items.value).toEqual(['b'])
  })

  it('reports a lister that throws instead of loading forever', async () => {
    const { contents } = setup(() => {
      throw new Error('no such channel')
    })
    await flushPromises()
    expect(contents.loading.value).toBe(false)
    expect(contents.error.value).toBe('no such channel')
  })

  it('re-queries from the first page when the search changes', async () => {
    const lister = vi.fn().mockResolvedValue(page(['a']))
    const { contents, query } = setup(lister)
    await flushPromises()
    query.value = 'flux'
    await nextTick()
    vi.advanceTimersByTime(250)
    await flushPromises()
    expect(lister).toHaveBeenLastCalledWith('a', expect.objectContaining({ query: 'flux' }))
    expect(lister.mock.lastCall![1].cursor).toBeUndefined()
    expect(contents.items.value).toEqual(['a'])
  })

  it('drops a slower, older response', async () => {
    let resolveFirst!: (p: InstallContentsPage<string>) => void
    const lister = vi
      .fn()
      .mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
      .mockResolvedValueOnce(page(['new']))
    const { contents } = setup(lister)
    await contents.refresh()
    resolveFirst(page(['old']))
    await flushPromises()
    expect(contents.items.value).toEqual(['new'])
  })

  it('refreshes when the build stops', async () => {
    const sessions = useSessionStore()
    sessions.runningInstances.set('a', { installationId: 'a' } as never)
    const lister = vi.fn().mockResolvedValue(page([]))
    setup(lister)
    await flushPromises()
    sessions.runningInstances.delete('a')
    await flushPromises()
    expect(lister).toHaveBeenCalledTimes(2)
  })

  it('reports an error or signed out instead of items', async () => {
    const lister = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, message: 'Cloud is down' })
      .mockResolvedValueOnce({ ok: false, message: 'Log in', signedOut: true })
    const { contents } = setup(lister)
    await flushPromises()
    expect(contents.error.value).toBe('Cloud is down')
    await contents.refresh()
    expect(contents.error.value).toBeNull()
    expect(contents.signedOut.value).toBe(true)
    expect(contents.items.value).toEqual([])
  })
})
