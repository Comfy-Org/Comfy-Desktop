import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import DialogHost from './DialogHost.vue'
import { useDialogs } from '../composables/useDialogs'

const dialogs = useDialogs()
let wrapper: VueWrapper

async function actionButton(): Promise<HTMLButtonElement> {
  await flushPromises()
  await vi.waitFor(() =>
    expect(document.querySelector('[data-testid="base-alert-action"]')).not.toBeNull()
  )
  return document.querySelector<HTMLButtonElement>('[data-testid="base-alert-action"]')!
}

beforeEach(() => {
  dialogs.cancel()
  wrapper = mount(DialogHost, { attachTo: document.body })
})

afterEach(async () => {
  dialogs.cancel()
  await flushPromises()
  wrapper.unmount()
  document.body.innerHTML = ''
})

describe('DialogHost button colours', () => {
  it('gives an error notice the white OK, never red', async () => {
    const shown = dialogs.alert({ title: 'Could not delete benchmark', message: 'Disk is busy' })
    const ok = await actionButton()
    expect(ok.getAttribute('data-variant')).toBe('inverted')
    expect(ok.classList).not.toContain('bg-destructive')
    ok.click()
    await expect(shown).resolves.toBeUndefined()
  })

  it('gives a confirm the white button unless it asks for danger', async () => {
    const shown = dialogs.confirm({ title: 'Stop ComfyUI', message: 'Stop it?' })
    expect((await actionButton()).getAttribute('data-variant')).toBe('inverted')
    dialogs.cancel()
    await expect(shown).resolves.toBe(false)
  })

  it('fills only the final button of a danger confirm red, next to a neutral Cancel', async () => {
    const shown = dialogs.confirm({
      title: 'Delete snapshot?',
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      tone: 'danger'
    })
    const action = await actionButton()
    const cancel = document.querySelector<HTMLButtonElement>('[data-testid="base-alert-cancel"]')!
    expect(action.getAttribute('data-variant')).toBe('destructive')
    expect(cancel.getAttribute('data-variant')).toBe('secondary')
    dialogs.cancel()
    await expect(shown).resolves.toBe(false)
  })
})
