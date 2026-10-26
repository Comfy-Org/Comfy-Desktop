import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { provideBuildRename } from './useBuildRename'
import type { Installation } from '../../types/ipc'

const alert = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../../composables/useModal', () => ({ useModal: () => ({ alert }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (k: string) => k }) }))

const updateInstallation = vi.fn()
Object.defineProperty(window, 'api', { value: { updateInstallation }, configurable: true })

const studio = { id: 'a', name: 'Studio', sourceId: 'standalone' } as Installation
const cloud = { id: 'c', name: 'Comfy Cloud', sourceId: 'cloud' } as Installation

function setup() {
  let api!: ReturnType<typeof provideBuildRename>
  mount(
    defineComponent({
      setup() {
        api = provideBuildRename()
        return () => h('div')
      }
    })
  )
  return api
}

describe('provideBuildRename', () => {
  beforeEach(() => {
    updateInstallation.mockReset()
    alert.mockClear()
  })

  it('renames one build at a time, on the surface it started from', () => {
    const rename = setup()
    rename.startRename(studio, 'sidebar')
    expect(rename.isRenaming(studio, 'sidebar')).toBe(true)
    expect(rename.isRenaming(studio, 'main')).toBe(false)
    rename.cancelRename()
    expect(rename.isRenaming(studio, 'sidebar')).toBe(false)
  })

  it('never renames the Comfy Cloud build', () => {
    const rename = setup()
    expect(rename.canRename(cloud)).toBe(false)
    rename.startRename(cloud, 'main')
    expect(rename.isRenaming(cloud, 'main')).toBe(false)
  })

  it('saves the name through main, and shows why main refused it', async () => {
    const rename = setup()
    updateInstallation.mockResolvedValueOnce({ ok: true })
    await rename.commitRename(studio, 'Studio 2')
    expect(updateInstallation).toHaveBeenCalledWith('a', { name: 'Studio 2' })
    expect(alert).not.toHaveBeenCalled()

    updateInstallation.mockResolvedValueOnce({ ok: false, message: 'Name taken' })
    await rename.commitRename(studio, 'Sketch')
    expect(alert).toHaveBeenCalledWith({
      title: 'buildsDashboard.rename.failed',
      message: 'Name taken'
    })

    updateInstallation.mockRejectedValueOnce(new Error('IPC gone'))
    await rename.commitRename(studio, 'Sketch')
    expect(alert).toHaveBeenLastCalledWith({
      title: 'buildsDashboard.rename.failed',
      message: 'IPC gone'
    })
  })
})
