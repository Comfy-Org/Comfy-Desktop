import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import TrackBuildForm from './TrackBuildForm.vue'
import { useModal } from '../composables/useModal'
import { TID } from '../../../shared/testIds'

vi.mock('../lib/telemetry', () => ({
  emitTelemetryAction: vi.fn(),
  toCountBucket: vi.fn(() => '1')
}))

const PROBE = { sourceId: 'portable', sourceLabel: 'Portable', installPath: '/home/user/Old' }

function stubApi(trackResult: Record<string, unknown>): void {
  window.api = {
    getUniqueName: vi.fn().mockResolvedValue('ComfyUI'),
    browseFolder: vi
      .fn()
      .mockResolvedValueOnce('/home/user/Old')
      .mockResolvedValueOnce('/home/user/New'),
    openPath: vi.fn(),
    probeInstallation: vi.fn(async (dir: string) => [{ ...PROBE, installPath: dir }]),
    trackInstallation: vi.fn().mockResolvedValue(trackResult)
  } as unknown as typeof window.api
}

type FormVm = { save: () => Promise<void> }

async function failToAdd(trackResult: Record<string, unknown>) {
  stubApi(trackResult)
  const wrapper = mount(TrackBuildForm)
  await flushPromises()
  await wrapper.get(`[data-testid="${TID.trackBrowse}"]`).trigger('click')
  await flushPromises()
  const saving = (wrapper.vm as unknown as FormVm).save()
  await flushPromises()
  return { wrapper, saving }
}

beforeEach(() => {
  useModal().dismiss()
})

describe('TrackBuildForm, when the build cannot be added', () => {
  it('offers Change location for a folder problem and opens the same folder picker', async () => {
    const { wrapper, saving } = await failToAdd({
      ok: false,
      message: 'That directory does not exist.',
      reason: 'location'
    })
    const modal = useModal()
    expect(modal.state.visible).toBe(true)
    expect(modal.state.title).toBe("Couldn't add this build")
    expect(modal.state.message).toBe('That directory does not exist.')
    expect(modal.state.showButton).toBe(true)
    expect(modal.state.buttonLabel).toBe('Change location')

    modal.close(true)
    await saving
    await flushPromises()

    expect(window.api.browseFolder).toHaveBeenCalledTimes(2)
    expect(window.api.browseFolder).toHaveBeenLastCalledWith('/home/user/Old')
    expect(window.api.probeInstallation).toHaveBeenLastCalledWith('/home/user/New')
    expect(wrapper.text()).toContain('/home/user/New')
    expect(window.api.trackInstallation).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('saved')).toBeUndefined()
  })

  it('shows any other failure with no footer button, only the close ×', async () => {
    const { wrapper, saving } = await failToAdd({
      ok: false,
      message: 'That directory is already used by "Studio".'
    })
    const modal = useModal()
    expect(modal.state.visible).toBe(true)
    expect(modal.state.message).toBe('That directory is already used by "Studio".')
    expect(modal.state.showButton).toBe(false)

    modal.dismiss()
    await saving
    await flushPromises()

    expect(window.api.browseFolder).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('saved')).toBeUndefined()
  })
})
