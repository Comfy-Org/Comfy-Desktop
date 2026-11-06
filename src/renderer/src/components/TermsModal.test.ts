import { describe, expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import TermsModal from './TermsModal.vue'
import { LEGAL_DOCS, type LegalDocId } from '../lib/legalDocs'

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

  it('emits `close` when the ✕ button is clicked', async () => {
    const wrapper = await mountModal('eula')
    await wrapper.find('[data-testid="base-modal-close"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
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
