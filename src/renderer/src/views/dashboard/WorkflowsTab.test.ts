import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import WorkflowsTab from './WorkflowsTab.vue'
import type { InstallContentsPage, InstallWorkflow, Installation } from '../../types/ipc'

const workflows: InstallWorkflow[] = [
  { path: 'portraits/hero.json', name: 'hero', folder: 'portraits', size: 2048, modifiedAt: 0 }
]
const page = (items: InstallWorkflow[]): InstallContentsPage<InstallWorkflow> => ({
  ok: true,
  items,
  nextCursor: null,
  total: items.length,
  truncated: false
})

const api = {
  listInstallWorkflows: vi.fn(async () => page(workflows)),
  comfybuilder: {
    getAuthStatus: vi.fn().mockResolvedValue({ signedIn: false }),
    onAuthChanged: vi.fn(() => () => {})
  }
}
Object.defineProperty(window, 'api', { value: api, configurable: true })

const inst = { id: 'i', sourceCategory: 'local' } as Installation

describe('WorkflowsTab', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('lists workflows with their folder and size, and opens the build from a row', async () => {
    const wrapper = mount(WorkflowsTab, { props: { installation: inst } })
    await flushPromises()
    const row = wrapper.findAll('[role="row"]')[1]!
    expect(row.text()).toContain('hero')
    expect(row.text()).toContain('portraits')
    expect(row.text()).toContain('2')
    await row.trigger('click')
    expect(wrapper.emitted('open')).toEqual([[inst]])
  })

  it('shows skeleton rows while the first page loads', async () => {
    let resolve!: (p: InstallContentsPage<InstallWorkflow>) => void
    api.listInstallWorkflows.mockImplementationOnce(() => new Promise((r) => (resolve = r)))
    const wrapper = mount(WorkflowsTab, { props: { installation: inst } })
    await flushPromises()
    expect(wrapper.find('[role="table"]').attributes('aria-busy')).toBe('true')
    resolve(page(workflows))
    await flushPromises()
    expect(wrapper.find('[role="table"]').attributes('aria-busy')).toBe('false')
  })
})
