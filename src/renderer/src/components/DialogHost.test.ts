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

describe('DialogHost update confirm', () => {
  it('shows the note with the Info icon and no outside close, and Cancel still closes it', async () => {
    const shown = dialogs.confirm({
      title: 'Update ComfyUI to v0.46.3?',
      message: '**v0.46.1** → **v0.46.3**',
      hint: 'ComfyUI is running and will restart.',
      note: 'If custom nodes break, restore the previous version from Snapshots.',
      confirmLabel: 'Update now'
    })
    await actionButton()
    expect(document.querySelector('.base-alert-title')!.textContent!.trim()).toBe(
      'Update ComfyUI to v0.46.3?'
    )
    expect(document.querySelector('[data-testid="base-alert-note-icon"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="base-alert-close-icon"]')).toBeNull()
    expect(document.querySelector('.base-alert-message')!.textContent).not.toMatch(
      /\p{Extended_Pictographic}/u
    )
    document.querySelector<HTMLButtonElement>('[data-testid="base-alert-cancel"]')!.click()
    await expect(shown).resolves.toBe(false)
  })
})
