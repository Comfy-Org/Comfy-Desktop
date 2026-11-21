import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { page as browserPage } from 'vitest/browser'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

import '../../assets/main.css'
import ChooserFamilyGrid from './ChooserFamilyGrid.vue'
import { TID } from '../../../../shared/testIds'
import { useSessionStore } from '../../stores/sessionStore'
import type { Installation } from '../../types/ipc'

const GRID_WIDTH = 900

function build(id: string, sourceCategory: 'local' | 'cloud' | 'remote', lastLaunchedAt: number) {
  return {
    id,
    name: id,
    lastLaunchedAt,
    sourceLabel: sourceCategory === 'cloud' ? 'Cloud' : 'Standalone',
    sourceCategory
  } satisfies Installation
}

const HOUR_MS = 60 * 60_000
const DAY_MS = 24 * HOUR_MS
const NOW = new Date(2026, 10, 20, 15, 0).getTime()

const FIRST_LOCAL = build('first-local', 'local', NOW - 2 * HOUR_MS)
const CLOUD = build('cloud', 'cloud', NOW - DAY_MS - HOUR_MS)
const SECOND_LOCAL = build('second-local', 'local', NOW - 3 * DAY_MS)
const THIRD_LOCAL = build('third-local', 'local', NOW - 10 * DAY_MS)
const ALL = [FIRST_LOCAL, CLOUD, SECOND_LOCAL, THIRD_LOCAL]

let host: HTMLElement
let wrapper: VueWrapper | undefined

function tile(installation: Installation): HTMLElement {
  return document.querySelector<HTMLElement>(
    `[data-testid="${TID.dashboardTile(installation.id)}"]`
  )!
}

function spot(installation: Installation): { left: number; top: number } {
  const el = tile(installation)
  return { left: el.offsetLeft, top: el.offsetTop }
}

async function mountGrid(installations: Installation[], loggedOut = false): Promise<VueWrapper> {
  wrapper = mount(ChooserFamilyGrid, {
    attachTo: host,
    props: { installations, loggedOut, isStoppedActionGated: () => false },
    global: { stubs: { transition: false, 'transition-group': false } }
  })
  await flushPromises()
  return wrapper
}

beforeAll(() => browserPage.viewport(1280, 900))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  ;(window as unknown as { api: unknown }).api = {
    getInstallations: vi.fn().mockResolvedValue([]),
    onInstallationsChanged: vi.fn(() => () => {}),
    onInstallationsVersionsUpdated: vi.fn(() => () => {}),
    onInstallProgress: vi.fn(() => () => {}),
    onComfyOutput: vi.fn(() => () => {}),
    getSetting: vi.fn().mockResolvedValue('none'),
    setSetting: vi.fn().mockResolvedValue(undefined),
    onSettingsChanged: vi.fn(() => () => {})
  }
  setActivePinia(createPinia())
  host = document.createElement('div')
  host.style.cssText = `position: absolute; left: 0; top: 0; width: ${GRID_WIDTH}px`
  document.body.append(host)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  host.remove()
  vi.useRealTimers()
})

describe('Builds grid filtering', () => {
  it('fades a filtered out tile where it stood and lets the rest take their new places', async () => {
    const grid = await mountGrid(ALL)
    const cloudSpot = spot(CLOUD)
    const secondLocalNewSpot = spot(CLOUD)
    const thirdLocalNewSpot = spot(SECOND_LOCAL)

    await grid.setProps({ installations: [FIRST_LOCAL, SECOND_LOCAL, THIRD_LOCAL] })
    await nextTick()

    expect(tile(CLOUD).className).toContain('tile-leave-active')
    expect(getComputedStyle(tile(CLOUD)).position).toBe('absolute')
    expect(spot(CLOUD)).toEqual(cloudSpot)
    expect(spot(SECOND_LOCAL)).toEqual(secondLocalNewSpot)
    expect(spot(THIRD_LOCAL)).toEqual(thirdLocalNewSpot)
  })

  it('keeps every leaving tile in place when a tab swaps the whole list', async () => {
    const grid = await mountGrid([FIRST_LOCAL, SECOND_LOCAL, THIRD_LOCAL])
    const before = [FIRST_LOCAL, SECOND_LOCAL, THIRD_LOCAL].map(spot)
    const firstCell = spot(FIRST_LOCAL)

    await grid.setProps({ installations: [CLOUD] })
    await nextTick()

    expect([FIRST_LOCAL, SECOND_LOCAL, THIRD_LOCAL].map(spot)).toEqual(before)
    for (const leaving of [FIRST_LOCAL, SECOND_LOCAL, THIRD_LOCAL]) {
      expect(getComputedStyle(tile(leaving)).position).toBe('absolute')
    }
    expect(spot(CLOUD)).toEqual(firstCell)
  })
})

describe('Builds tile status', () => {
  it('shows Running with the green dot on a build running in the background with no window', async () => {
    const session = useSessionStore()
    session.runningInstances.set(FIRST_LOCAL.id, {
      installationId: FIRST_LOCAL.id,
      installationName: FIRST_LOCAL.name,
      mode: 'window'
    })
    expect(session.activeSessions.size).toBe(0)
    await mountGrid(ALL)

    const running = tile(FIRST_LOCAL).querySelector('.chooser-tile-status--running')
    expect(running?.textContent?.trim()).toBe('Running')
    expect(running?.querySelector('.rounded-full')).not.toBeNull()
  })

  it('shows Comfy Cloud by when it was last used, with no green dot, never Always on', async () => {
    await mountGrid(ALL)

    expect(tile(CLOUD).textContent).not.toContain('Always on')
    expect(tile(CLOUD).textContent).toContain('Used yesterday')
    expect(tile(CLOUD).querySelector('.rounded-full.bg-\\[\\#59d38c\\]')).toBeNull()
  })

  it('asks a logged-out user to log in to use Comfy Cloud, while local builds say when they were last used', async () => {
    await mountGrid(ALL, true)

    expect(tile(CLOUD).textContent).toContain('Log in to use')
    expect(tile(CLOUD).textContent).not.toContain('Used')
    expect(tile(FIRST_LOCAL).textContent).toContain('Used 2h ago')
  })

  it('says how long ago each resting build was used, with no check icon', async () => {
    await mountGrid(ALL)

    expect(tile(FIRST_LOCAL).textContent).toContain('Used 2h ago')
    expect(tile(SECOND_LOCAL).textContent).toContain('Used 3d ago')
    expect(tile(THIRD_LOCAL).textContent).toContain('Used 10d ago')
    for (const resting of ALL) {
      expect(tile(resting).querySelector('.lucide-check')).toBeNull()
    }
  })

  it('says when a build was stopped, not when it was started, after a long run', async () => {
    const longRun = {
      ...build('long-run', 'local', NOW - 6 * HOUR_MS),
      lastStoppedAt: NOW - HOUR_MS
    }
    await mountGrid([longRun])

    expect(tile(longRun).textContent).toContain('Used 1h ago')
  })

  it('says Never used on a build that was never opened', async () => {
    const fresh = { ...build('fresh', 'local', 0), lastLaunchedAt: undefined }
    await mountGrid([fresh])

    expect(tile(fresh).textContent).toContain('Never used')
  })

  it('says No setup needed, not Never used, on a Comfy Cloud that was never opened', async () => {
    const freshCloud = { ...build('fresh-cloud', 'cloud', 0), lastLaunchedAt: undefined }
    await mountGrid([freshCloud])

    expect(tile(freshCloud).textContent).toContain('No setup needed')
    expect(tile(freshCloud).textContent).not.toContain('Never used')
  })

  it('shows Running with the green dot while Comfy Cloud is open, like a local build', async () => {
    useSessionStore().runningInstances.set(CLOUD.id, {
      installationId: CLOUD.id,
      installationName: CLOUD.name,
      mode: 'window'
    })
    await mountGrid(ALL)

    const running = tile(CLOUD).querySelector('.chooser-tile-status--running')
    expect(running?.textContent?.trim()).toBe('Running')
    expect(running?.querySelector('.rounded-full')).not.toBeNull()
    expect(tile(CLOUD).textContent).not.toContain('Used')
  })

  it('shows Running with the green dot while a remote server is connected', async () => {
    const remote = build('remote', 'remote', 100)
    useSessionStore().runningInstances.set(remote.id, {
      installationId: remote.id,
      installationName: remote.name,
      mode: 'window'
    })
    await mountGrid([...ALL, remote])

    const running = tile(remote).querySelector('.chooser-tile-status--running')
    expect(running?.textContent?.trim()).toBe('Running')
    expect(running?.querySelector('.rounded-full')).not.toBeNull()
  })
})
