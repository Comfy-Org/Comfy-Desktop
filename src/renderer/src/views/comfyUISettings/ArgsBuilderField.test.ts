import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
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

function stubElectronApi(): void {
  ;(window as unknown as { api: unknown }).api = {
    getComfyArgs: vi.fn().mockResolvedValue({ args: SCHEMA })
  }
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

beforeEach(() => stubElectronApi())
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
  it('shows no pill for a field without beta grants', async () => {
    const wrapper = await mountField({ field: { ...FIELD, value: '--lowvram' } })
    expect(wrapper.find('.beta-args').exists()).toBe(false)
  })

  it("shows the running session's grants after the user's args, before the gear", async () => {
    const wrapper = await mountField({
      field: {
        ...FIELD,
        value: '--lowvram',
        betaArgs: [{ arg: '--enable-assets', name: 'Asset browser' }]
      }
    })
    const trailing = wrapper.find('.ui-input-trailing')
    const buttons = trailing.findAll('button')
    expect(buttons).toHaveLength(2)
    expect(buttons[0]!.classes()).toContain('beta-args-pill')
    expect(buttons[1]!.attributes('aria-label')).toBe('Configure arguments')
    // The grants never enter the editable value: the user's own string is untouched.
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('--lowvram')
  })
})

describe('ArgsBuilderField — beta pill timing', () => {
  it("passes a stopped install's next-launch timing to the pill", async () => {
    const wrapper = await mountField({
      field: {
        ...FIELD,
        betaArgs: [{ arg: '--enable-assets', name: null }],
        betaArgsTiming: 'next-launch'
      }
    })
    expect(wrapper.get('button.beta-args-pill').attributes('aria-label')).toBe(
      'comfyUISettings.betaArgsAriaLabelNext'
    )
  })
})

describe('ArgsBuilderField — asks for a re-read after schema discovery', () => {
  function stubArgs(result: Record<string, unknown>): void {
    ;(window as unknown as { api: unknown }).api = {
      getComfyArgs: vi.fn().mockResolvedValue({ args: SCHEMA, ...result })
    }
  }

  it('emits schema-discovered when its load ran discovery and no pill is showing', async () => {
    stubArgs({ discovered: true })
    const wrapper = await mountField()
    expect(wrapper.emitted('schema-discovered')).toHaveLength(1)
  })

  it.each([
    ['the schema came from the cache', { discovered: false }, {}],
    ['discovery failed', { discovered: true, error: 'no python' }, {}],
    [
      'the field already carries grants',
      { discovered: true },
      { betaArgs: [{ arg: '--enable-assets', name: null }] }
    ]
  ])('stays quiet when %s', async (_label, result, field) => {
    stubArgs(result)
    const wrapper = await mountField({ field: { ...FIELD, ...field } })
    expect(wrapper.emitted('schema-discovered')).toBeUndefined()
  })
})

describe('ArgsBuilderField — trailing buttons stay out of autocomplete', () => {
  const BETA = [{ arg: '--enable-assets', name: 'Asset browser' }]

  async function typePartialFlag(wrapper: VueWrapper): Promise<void> {
    const input = wrapper.get('input')
    await input.trigger('focusin')
    await input.setValue('--lo')
    await flushPromises()
    expect(wrapper.find('.args-raw-input-ac').exists()).toBe(true)
  }

  it('Enter on the beta pill does not complete a partially typed flag', async () => {
    const wrapper = await mountField({ field: { ...FIELD, betaArgs: BETA } })
    await typePartialFlag(wrapper)
    const pill = wrapper.get('button.beta-args-pill')
    await wrapper.get('input').trigger('focusout')
    await pill.trigger('focusin')
    await pill.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    // Typing commits '--lo' itself; what must never be committed is the completed flag.
    const committed = (wrapper.emitted('update') ?? []).map(([, value]) => value)
    expect(committed.some((value) => String(value).includes('--lowvram'))).toBe(false)
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('--lo')
  })

  it('moving focus to a trailing button closes the suggestions', async () => {
    const wrapper = await mountField({ field: { ...FIELD, betaArgs: BETA } })
    await typePartialFlag(wrapper)
    await wrapper.get('input').trigger('focusout')
    await wrapper.get('button.beta-args-pill').trigger('focusin')
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
