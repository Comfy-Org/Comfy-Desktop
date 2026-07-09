import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runPromptChain } from './actionShoppingList'
import type { ActionDef } from '../types/ipc'

// Minimal driver stub: runPromptChain only ever touches `.prompt`.
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
      ...overrides,
    },
  } as ActionDef
}

beforeEach(() => {
  window.api = {
    getUniqueName: vi.fn().mockResolvedValue('ComfyUI (8)'),
  } as unknown as typeof window.api
})

describe('runPromptChain — uniquifyDefault', () => {
  it('shows the deduped name when uniquifyDefault is set (matches what save assigns)', async () => {
    const { driver, prompt } = makeDriver('ComfyUI (8)')
    const result = await runPromptChain(copyAction({ uniquifyDefault: true }), driver)

    expect(window.api.getUniqueName).toHaveBeenCalledWith('ComfyUI (2)')
    // The prompt is pre-filled with the resolved unique name, not the raw source name.
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
