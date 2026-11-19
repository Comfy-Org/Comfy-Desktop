import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import MigrateConfirmTakeover from './MigrateConfirmTakeover.vue'

type MigrationResult = { confirmed: boolean; checkboxValues: Record<string, boolean> }
type MigrationController = {
  open: (title: string, confirmLabel: string) => Promise<MigrationResult>
  update: (options: { title: string }) => void
}

let wrapper: VueWrapper

async function settle(): Promise<void> {
  await flushPromises()
  await vi.runAllTimersAsync()
  await flushPromises()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  wrapper = mount(MigrateConfirmTakeover, { attachTo: document.body })
})

afterEach(async () => {
  wrapper.unmount()
  await settle()
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('MigrateConfirmTakeover shared dialog lifecycle', () => {
  it('keeps its accessible name current and resolves Escape as cancellation', async () => {
    const migration = wrapper.vm as unknown as MigrationController
    const result = migration.open('Migrate existing installation', 'Migrate')
    await settle()
    const dialog = document.querySelector<HTMLElement>('.brand-takeover-root')!
    expect(dialog.getAttribute('aria-label')).toBe('Migrate existing installation')
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)

    migration.update({ title: 'Migrate My ComfyUI' })
    await settle()
    expect(dialog.getAttribute('aria-label')).toBe('Migrate My ComfyUI')
    dialog.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    )
    await expect(result).resolves.toEqual({ confirmed: false, checkboxValues: {} })
    await settle()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('resolves a pending confirmation when its host removes the takeover', async () => {
    const migration = wrapper.vm as unknown as MigrationController
    const result = migration.open('Migrate existing installation', 'Migrate')
    await settle()
    wrapper.unmount()
    await expect(result).resolves.toEqual({ confirmed: false, checkboxValues: {} })
  })
})
