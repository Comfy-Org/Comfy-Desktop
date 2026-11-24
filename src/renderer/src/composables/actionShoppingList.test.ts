import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import zh from '@locales/zh.json'
import { i18n } from '../i18n'
import { runConfirmChain, runPromptChain } from './actionShoppingList'
import type { ActionDef } from '../types/ipc'

function makeDriver(returnValue: string | null) {
  const prompt = vi.fn().mockResolvedValue(returnValue)
  return { driver: { prompt } as unknown as Parameters<typeof runPromptChain>[1], prompt }
}

function copyAction(overrides: Partial<ActionDef['prompt']> = {}): ActionDef {
  return {
    id: 'copy',
    label: 'Copy',
    prompt: {
      field: 'name',
      title: 'Copy',
      defaultValue: 'ComfyUI (2)',
      ...overrides
    }
  } as ActionDef
}

beforeEach(() => {
  window.api = {
    getUniqueName: vi.fn().mockResolvedValue('ComfyUI (8)')
  } as unknown as typeof window.api
})

describe('runPromptChain — uniquifyDefault', () => {
  it('shows the deduped name when uniquifyDefault is set (matches what save assigns)', async () => {
    const { driver, prompt } = makeDriver('ComfyUI (8)')
    const result = await runPromptChain(copyAction({ uniquifyDefault: true }), driver)

    expect(window.api.getUniqueName).toHaveBeenCalledWith('ComfyUI (2)')
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ defaultValue: 'ComfyUI (8)' }))
    expect(result?.data?.name).toBe('ComfyUI (8)')
  })

  it('leaves the default untouched when uniquifyDefault is not set (e.g. rename)', async () => {
    const { driver, prompt } = makeDriver('ComfyUI (2)')
    await runPromptChain(copyAction(), driver)

    expect(window.api.getUniqueName).not.toHaveBeenCalled()
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ defaultValue: 'ComfyUI (2)' }))
  })

  it('falls back to the raw default if getUniqueName rejects (save-time dedup still applies)', async () => {
    vi.mocked(window.api.getUniqueName).mockRejectedValueOnce(new Error('ipc down'))
    const { driver, prompt } = makeDriver('ComfyUI (2)')
    await runPromptChain(copyAction({ uniquifyDefault: true }), driver)

    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ defaultValue: 'ComfyUI (2)' }))
  })

  it('returns null (cancels the chain) when the user dismisses the prompt', async () => {
    const { driver } = makeDriver(null)
    const result = await runPromptChain(copyAction({ uniquifyDefault: true }), driver)
    expect(result).toBeNull()
  })
})

describe('runConfirmChain confirm colour', () => {
  type ConfirmModal = Parameters<typeof runConfirmChain>[1]
  type ConfirmDialogs = NonNullable<Parameters<typeof runConfirmChain>[2]>

  function confirmAction(style: string | undefined, extra: Partial<ActionDef['confirm']> = {}) {
    return {
      id: 'some-action',
      label: 'Do it',
      style,
      confirm: { title: 'Sure?', message: 'Really?', ...extra }
    } as ActionDef
  }

  function makeModal() {
    const confirm = vi.fn().mockResolvedValue(false)
    const confirmWithOptions = vi.fn().mockResolvedValue(null)
    return {
      modal: { confirm, confirmWithOptions } as unknown as ConfirmModal,
      confirm,
      confirmWithOptions
    }
  }

  it.each([
    ['danger', 'danger'],
    ['primary', 'primary'],
    ['accent', 'primary'],
    ['default', 'primary'],
    [undefined, 'primary']
  ])('a %s action confirms in the panel with the %s button', async (style, tone) => {
    const confirm = vi.fn().mockResolvedValue(false)
    await runConfirmChain(confirmAction(style), makeModal().modal, {
      confirm
    } as unknown as ConfirmDialogs)
    expect(confirm.mock.calls[0]![0].tone).toBe(tone)
  })

  it('asks to Forget a build with a white Forget button, since its files stay', async () => {
    const forget = {
      id: 'remove',
      label: 'Forget',
      style: 'default',
      confirm: { title: 'Forget build', message: 'Its folder stays on your computer.' }
    } as unknown as ActionDef
    const confirm = vi.fn().mockResolvedValue('primary')
    await runConfirmChain(forget, makeModal().modal, { confirm } as unknown as ConfirmDialogs)
    expect(confirm.mock.calls[0]![0]).toMatchObject({ confirmLabel: 'Forget', tone: 'primary' })
  })

  it.each([
    ['danger', 'danger'],
    ['default', 'primary'],
    [undefined, 'primary']
  ])('a %s action confirms in the modal with the %s button', async (style, confirmStyle) => {
    const { modal, confirm } = makeModal()
    await runConfirmChain(confirmAction(style), modal)
    expect(confirm.mock.calls[0]![0].confirmStyle).toBe(confirmStyle)
  })

  it.each([
    ['danger', 'danger'],
    [undefined, 'primary']
  ])('a %s action with options confirms with the %s button', async (style, confirmStyle) => {
    const { modal, confirmWithOptions } = makeModal()
    await runConfirmChain(
      confirmAction(style, { options: [{ id: 'a', label: 'A', checked: true }] }),
      modal
    )
    expect(confirmWithOptions.mock.calls[0]![0].confirmStyle).toBe(confirmStyle)
  })
})

describe('runConfirmChain with no confirm text from Desktop', () => {
  afterEach(() => {
    i18n.global.locale.value = 'en'
  })

  it('asks in the app language', async () => {
    i18n.global.setLocaleMessage('zh', zh)
    i18n.global.locale.value = 'zh'
    const confirm = vi.fn().mockResolvedValue(false)

    await runConfirmChain(
      { id: 'some-action', label: 'Do it', confirm: {} } as ActionDef,
      { confirm } as unknown as Parameters<typeof runConfirmChain>[1]
    )

    expect(confirm.mock.calls[0]![0]).toMatchObject({
      title: zh.modal.confirm,
      message: zh.modal.areYouSure
    })
  })
})
