import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { SETTINGS_REOPEN_EPOCH } from './settingsReopenEpoch'
import ArgsBuilderField from './ArgsBuilderField.vue'
import type { ComfyArgDef, DetailField } from '../../types/ipc'

// Tests that the args-field autocomplete appears, narrows on typing, and commits the picked flag via `update`.

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: { en: {} },
  missingWarn: false,
  fallbackWarn: false
})

const SCHEMA: ComfyArgDef[] = [
  { name: 'cpu', flag: '--cpu', help: 'Run on CPU only.', type: 'boolean', category: 'gpuVram' },
  {
    name: 'lowvram',
    flag: '--lowvram',
    help: 'Reduce VRAM.',
    type: 'boolean',
    category: 'gpuVram'
  },
  { name: 'novram', flag: '--novram', help: 'No VRAM.', type: 'boolean', category: 'gpuVram' },
  {
    name: 'port',
    flag: '--port',
    help: 'Server port.',
    type: 'value',
    metavar: 'PORT',
    category: 'network'
  }
]

const FIELD: DetailField = {
  id: 'launchArgs',
  label: 'Startup Arguments',
  editType: 'args-builder',
  value: ''
} as DetailField

const BETA = { timing: 'session', args: [{ arg: '--enable-assets', name: 'Asset browser' }] }

function stubElectronApi(beta: unknown = { timing: 'next-launch', args: [] }): {
  getComfyArgs: ReturnType<typeof vi.fn>
  getCoreBetaArgs: ReturnType<typeof vi.fn>
} {
  const api = {
    getComfyArgs: vi.fn().mockResolvedValue({ args: SCHEMA }),
    getCoreBetaArgs: vi.fn().mockResolvedValue(beta)
  }
  ;(window as unknown as { api: unknown }).api = api
  return api
}

const wrappers: VueWrapper[] = []

async function mountField(
  props: { field?: DetailField; installationId?: string | null } = {}
): Promise<VueWrapper> {
  const installationId = 'installationId' in props ? props.installationId : 'inst-1'
  const wrapper = mount(ArgsBuilderField, {
    props: {
      field: { ...FIELD, ...(props.field ?? {}) },
      ...(installationId == null ? {} : { installationId })
    },
    global: { plugins: [i18n] },
    attachTo: document.body
  })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
  stubElectronApi()
})
afterEach(() => {
  while (wrappers.length) wrappers.pop()?.unmount()
  delete (window as unknown as { api?: unknown }).api
  vi.restoreAllMocks()
})

describe('ArgsBuilderField — inline autocomplete', () => {
  it('does not render the popover when the input is empty', async () => {
    const wrapper = await mountField()
    expect(wrapper.find('.args-raw-input-ac').exists()).toBe(false)
  })

  it('renders matching suggestions while the user types a partial flag', async () => {
    const wrapper = await mountField()
    const input = wrapper.get('input')
    await input.trigger('focusin')
    await input.setValue('--lo')
    await flushPromises()

    const popover = wrapper.find('.args-raw-input-ac')
    expect(popover.exists()).toBe(true)
    const names = popover.findAll('.args-raw-input-ac-flag').map((n) => n.text())
    expect(names).toContain('--lowvram')
    // `--cpu` doesn't match "lo" so it shouldn't surface.
    expect(names).not.toContain('--cpu')
  })

  it('shows help text per suggestion', async () => {
    const wrapper = await mountField()
    const input = wrapper.get('input')
    await input.trigger('focusin')
    await input.setValue('--lo')
    await flushPromises()
    expect(wrapper.find('.args-raw-input-ac').text()).toContain('Reduce VRAM')
  })

  it('emits `update` with the spliced flag when a suggestion is clicked', async () => {
    const wrapper = await mountField()
    const input = wrapper.get('input')
    await input.trigger('focusin')
    await input.setValue('--lo')
    await flushPromises()

    const lowvramOption = wrapper
      .findAll('.args-raw-input-ac-item')
      .find((o) => o.text().includes('--lowvram'))
    await lowvramOption?.trigger('mousedown')
    await flushPromises()

    const events = wrapper.emitted('update') ?? []
    expect(events.length).toBeGreaterThan(0)
    const lastValue = events.at(-1)?.[1] as string
    expect(lastValue).toBe('--lowvram ')
  })

  it('hides the popover on Escape but reopens on the next keystroke', async () => {
    const wrapper = await mountField()
    const input = wrapper.get('input')
    await input.trigger('focusin')
    await input.setValue('--lo')
    await flushPromises()
    expect(wrapper.find('.args-raw-input-ac').exists()).toBe(true)

    await input.trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(wrapper.find('.args-raw-input-ac').exists()).toBe(false)

    await input.setValue('--low')
    await flushPromises()
    expect(wrapper.find('.args-raw-input-ac').exists()).toBe(true)
  })

  it('suppresses suggestions while filling a value-typed flag', async () => {
    const wrapper = await mountField()
    const input = wrapper.get('input')
    await input.trigger('focusin')
    // `--port` is a value-type flag — after the space the user is
    // typing the PORT value, not a flag name, so no dropdown.
    await input.setValue('--port 81')
    await flushPromises()
    expect(wrapper.find('.args-raw-input-ac').exists()).toBe(false)
  })

  it('still works as a plain text input when no installationId is provided', async () => {
    const wrapper = await mountField({ installationId: null })
    expect(wrapper.find('input').exists()).toBe(true)
    expect(
      (window as unknown as { api: { getComfyArgs: ReturnType<typeof vi.fn> } }).api.getComfyArgs
    ).not.toHaveBeenCalled()
    expect(wrapper.find('.args-raw-input-ac').exists()).toBe(false)
  })

  it('disables native spellcheck so flags do not get red squiggles', async () => {
    const wrapper = await mountField()
    expect(wrapper.find('input').attributes('spellcheck')).toBe('false')
  })

  it('surfaces the correctness check in the compact field, not just the helper page', async () => {
    const wrapper = await mountField({ field: { ...FIELD, value: '--bogus' } })
    const err = wrapper.find('.args-raw-validation-error')
    expect(err.exists()).toBe(true)
    expect(err.text()).toContain('--bogus')
    expect(wrapper.find('input[aria-invalid="true"]').exists()).toBe(true)
  })
})

describe('ArgsBuilderField — beta args pill', () => {
  it("shows the pill for the field's install", async () => {
    const api = stubElectronApi(BETA)
    const wrapper = await mountField()
    expect(api.getCoreBetaArgs).toHaveBeenCalledWith('inst-1', undefined)
    expect(wrapper.find('.beta-args').text()).toContain('betaArgsPill')
  })

  it('asks again once its schema load settles, since the preview reads that cache', async () => {
    let settle: (value: unknown) => void = () => {}
    const api = stubElectronApi()
    api.getComfyArgs.mockReturnValue(new Promise((resolve) => (settle = resolve)))
    await mountField()
    const before = api.getCoreBetaArgs.mock.calls.length
    settle({ args: SCHEMA })
    await flushPromises()
    expect(api.getCoreBetaArgs.mock.calls.length).toBe(before + 1)
  })

  it('asks again when the committed args change, and not while typing', async () => {
    const api = stubElectronApi()
    const wrapper = await mountField()
    const before = api.getCoreBetaArgs.mock.calls.length
    await wrapper.get('input').setValue('--disable-assets')
    await flushPromises()
    expect(api.getCoreBetaArgs.mock.calls.length).toBe(before)
    await wrapper.setProps({ field: { ...FIELD, value: '--disable-assets' } })
    await flushPromises()
    expect(api.getCoreBetaArgs.mock.calls.length).toBe(before + 1)
  })

  it('reloads its schema when a host that stays mounted is reopened', async () => {
    const api = stubElectronApi()
    const epoch = ref(1)
    const wrapper = mount(ArgsBuilderField, {
      props: { field: FIELD, installationId: 'inst-1' },
      global: { plugins: [i18n], provide: { [SETTINGS_REOPEN_EPOCH as symbol]: epoch } }
    })
    wrappers.push(wrapper)
    await flushPromises()
    expect(api.getComfyArgs).toHaveBeenCalledTimes(1)
    epoch.value = 2
    await flushPromises()
    expect(api.getComfyArgs).toHaveBeenCalledTimes(2)
  })

  it('asks for beta args once on mount and once per reopen, never twice', async () => {
    const api = stubElectronApi()
    const epoch = ref(1)
    const wrapper = mount(ArgsBuilderField, {
      props: { field: FIELD, installationId: 'inst-1' },
      global: { plugins: [i18n], provide: { [SETTINGS_REOPEN_EPOCH as symbol]: epoch } }
    })
    wrappers.push(wrapper)
    await flushPromises()
    expect(api.getCoreBetaArgs).toHaveBeenCalledTimes(1)
    epoch.value = 2
    await flushPromises()
    expect(api.getCoreBetaArgs).toHaveBeenCalledTimes(2)
  })

  it('keeps the newest schema when an older load resolves after it', async () => {
    const api = stubElectronApi()
    let resolveOld: (value: unknown) => void = () => {}
    api.getComfyArgs
      .mockReturnValueOnce(new Promise((resolve) => (resolveOld = resolve)))
      .mockResolvedValueOnce({ args: SCHEMA })
    const epoch = ref(1)
    const wrapper = mount(ArgsBuilderField, {
      props: { field: FIELD, installationId: 'inst-1' },
      global: { plugins: [i18n], provide: { [SETTINGS_REOPEN_EPOCH as symbol]: epoch } },
      attachTo: document.body
    })
    wrappers.push(wrapper)
    epoch.value = 2
    await flushPromises()
    const before = api.getCoreBetaArgs.mock.calls.length
    resolveOld({ args: [] })
    await flushPromises()

    // The stale load neither replaces the schema nor asks the pill to look again.
    expect(api.getCoreBetaArgs.mock.calls.length).toBe(before)
    await wrapper.get('input').trigger('focusin')
    await wrapper.get('input').setValue('--lo')
    await flushPromises()
    expect(wrapper.find('.args-raw-input-ac').text()).toContain('--lowvram')
  })

  it('has no pill without an install to ask about', async () => {
    const api = stubElectronApi(BETA)
    const wrapper = await mountField({ installationId: null })
    expect(api.getCoreBetaArgs).not.toHaveBeenCalled()
    expect(wrapper.find('.beta-args').exists()).toBe(false)
  })
})

describe('ArgsBuilderField — trailing buttons stay out of autocomplete', () => {
  async function typePartialFlag(wrapper: VueWrapper): Promise<void> {
    const input = wrapper.get('input')
    await input.trigger('focusin')
    await input.setValue('--lo')
    await flushPromises()
    expect(wrapper.find('.args-raw-input-ac').exists()).toBe(true)
  }

  it('Enter on the beta pill does not complete a partially typed flag', async () => {
    stubElectronApi(BETA)
    const wrapper = await mountField()
    await typePartialFlag(wrapper)
    const pill = wrapper.get('.beta-args button')
    await wrapper.get('input').trigger('focusout')
    await pill.trigger('focusin')
    await pill.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    // Typing commits '--lo' itself; what must never be committed is the completed flag.
    const committed = (wrapper.emitted('update') ?? []).map(([, value]) => value)
    expect(committed.some((value) => String(value).includes('--lowvram'))).toBe(false)
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('--lo')
  })

  it('a key pressed on a trailing button never reaches the open suggestions', async () => {
    stubElectronApi(BETA)
    const wrapper = await mountField()
    await typePartialFlag(wrapper)
    // Suggestions still open: the keydown alone has to be ignored, not the focus change.
    await wrapper.get('.beta-args button').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    const committed = (wrapper.emitted('update') ?? []).map(([, value]) => value)
    expect(committed.some((value) => String(value).includes('--lowvram'))).toBe(false)
  })

  it('moving focus to a trailing button closes the suggestions', async () => {
    stubElectronApi(BETA)
    const wrapper = await mountField()
    await typePartialFlag(wrapper)
    await wrapper.get('input').trigger('focusout')
    await wrapper.get('.beta-args button').trigger('focusin')
    await flushPromises()
    expect(wrapper.find('.args-raw-input-ac').exists()).toBe(false)
  })

  it('Enter in the text input still accepts the highlighted suggestion', async () => {
    const wrapper = await mountField()
    await typePartialFlag(wrapper)
    await wrapper.get('input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    const committed = (wrapper.emitted('update') ?? []).map(([, value]) => value)
    expect(committed.some((value) => String(value).includes('--lowvram'))).toBe(true)
  })
})
