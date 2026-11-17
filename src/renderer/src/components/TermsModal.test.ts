import { describe, expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import TermsModal from './TermsModal.vue'
import { LEGAL_DOCS, type LegalDocId } from '../lib/legalDocs'
import en from '@locales/en.json'

async function mountModal(doc?: LegalDocId) {
  const wrapper = mount(TermsModal, {
    attachTo: document.body,
    props: doc ? { doc } : {},
    global: {
      stubs: { Teleport: { template: '<div><slot /></div>' } }
    }
  })
  await flushPromises()
  return wrapper
}

describe('TermsModal', async () => {
  it.each<[LegalDocId, string]>([
    ['eula', 'End-User License Agreement'],
    ['tos', 'Terms of Service'],
    ['privacy', 'Privacy Policy'],
    ['notices', 'Third-Party Notices']
  ])('renders the correct title and meta for doc="%s"', async (doc, expectedTitle) => {
    const wrapper = await mountModal(doc)
    expect(wrapper.find('.terms-title').text()).toBe(expectedTitle)
    const meta = wrapper.find('.terms-meta').text()
    expect(meta).toContain(LEGAL_DOCS[doc].effectiveDate)
    expect(meta).toContain(LEGAL_DOCS[doc].appliesTo)
  })

  it('defaults to the privacy doc when no `doc` prop is supplied', async () => {
    const wrapper = await mountModal()
    expect(wrapper.find('.terms-title').text()).toBe('Privacy Policy')
  })

  it('sets the title in the body typeface, not the display one', async () => {
    const wrapper = await mountModal('privacy')
    expect(wrapper.find('.terms-title').classes()).not.toContain('font-display')
  })

  it('puts the round close button outside the window, like the setup sheets', async () => {
    const wrapper = await mountModal('privacy')
    const close = wrapper.find('[data-testid="base-modal-close"]')
    expect(close.classes()).toEqual(expect.arrayContaining(['-right-12', 'rounded-full']))
  })

  it('emits `close` when the ✕ button is clicked', async () => {
    const wrapper = await mountModal('eula')
    await wrapper.find('[data-testid="base-modal-close"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('shows the redacted credential patterns as code instead of literal backticks', async () => {
    const body = (await mountModal('privacy')).find('.terms-body')
    expect(body.text()).not.toContain('`')
    const codeSpans = body.findAll('code').map((c) => c.text())
    expect(codeSpans).toEqual(expect.arrayContaining(['sk-*', 'hf_*', 'KEY=', 'SECRET=']))
  })

  it('sends readers to the Settings tab and group that hold the telemetry switch', () => {
    const settingsPaths = Object.values(LEGAL_DOCS)
      .flatMap((doc) => doc.blocks.flatMap((block) => [block.text ?? '', ...(block.items ?? [])]))
      .flatMap((text) => [...text.matchAll(/Settings → ([^→*,.]+?) → ([^→*,.]+?)(?=[*,.])/g)])
      .map(([, tab, group]) => `${tab} → ${group}`)

    expect(settingsPaths.length).toBeGreaterThan(0)
    expect(new Set(settingsPaths)).toEqual(
      new Set([`${en.settings.general} → ${en.settings.privacy}`])
    )
    expect(JSON.stringify(LEGAL_DOCS)).not.toContain('Settings → Telemetry')
  })

  it('renders block content from the routed doc (not from a stale fallback)', async () => {
    const eulaText = (await mountModal('eula')).find('.terms-body').text()
    const tosText = (await mountModal('tos')).find('.terms-body').text()
    expect(eulaText).toContain('1. Definitions')
    expect(eulaText).not.toContain('1. Acceptance')
    expect(tosText).toContain('1. Acceptance')
    expect(tosText).not.toContain('1. Definitions')
  })
})
