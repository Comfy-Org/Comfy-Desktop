import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { effectScope } from 'vue'

import HomeTemplateSearch from './HomeTemplateSearch.vue'
import TemplateSearchResults from './TemplateSearchResults.vue'
import { useTemplateSearch } from './useTemplateSearch'
import type { TemplateSearchClient } from './templateSearch'
import type {
  TemplateSearchCandidate,
  TemplateSearchResponse,
  TemplateSearchResult
} from '../../types/ipc'

const search = vi.fn<(query: string) => Promise<TemplateSearchResponse>>()
const open = vi.fn<TemplateSearchClient['open']>()

function candidate(templateId: string, over: Partial<TemplateSearchCandidate> = {}) {
  return {
    templateId,
    title: `${templateId} title`,
    thumbnailUrl: null,
    family: null,
    partner: false,
    rewrite: false,
    needsDownload: false,
    score: 0.92,
    belowThreshold: false,
    missing: [],
    ...over
  }
}

const POSTER = candidate('poster_template')
const BANNER = candidate('banner_template')
const MURAL = candidate('mural_template', {
  missing: ['mural.safetensors'],
  needsDownload: true
})

function answer(result: Partial<TemplateSearchResult>): TemplateSearchResponse {
  return {
    kind: 'result',
    result: { outcome: 'template', reply: null, run: [], download: [], alsoTry: [], ...result }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  search.mockResolvedValue(answer({ run: [POSTER, BANNER], download: [MURAL] }))
  open.mockResolvedValue(true)
})

afterEach(() => {
  vi.useRealTimers()
})

function mountSearch(blockedReason: string | null = null, refreshKey = '') {
  return mount(HomeTemplateSearch, {
    props: { client: { search, open }, blockedReason, refreshKey },
    attachTo: document.body
  })
}

function opened(): string[] {
  return open.mock.calls.map(([picked]) => picked.templateId)
}

async function searchFor(wrapper: ReturnType<typeof mountSearch>, text: string) {
  const input = wrapper.get('[data-testid="home-template-search-input"]')
  await input.setValue(text)
  await input.trigger('keydown', { key: 'Enter' })
  await flushPromises()
}

function rowTitles(wrapper: ReturnType<typeof mountSearch>): string[] {
  return wrapper.findAll('[role="option"]').map((row) => row.find('.font-medium').text())
}

describe('HomeTemplateSearch', () => {
  it('lists the templates to run, then the ones to download, then the agent', async () => {
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster for a bake sale')

    expect(search).toHaveBeenCalledWith('a poster for a bake sale')
    expect(rowTitles(wrapper)).toEqual([
      'poster_template title',
      'banner_template title',
      'mural_template title',
      'Build it with the agent'
    ])
    expect(wrapper.findAll('[data-testid="home-template-search-row-run"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('Downloads mural.safetensors')
  })

  it('lists lower-confidence templates under Also try, after the download ones', async () => {
    search.mockResolvedValue(answer({ run: [POSTER], download: [MURAL], alsoTry: [BANNER] }))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster for a bake sale')

    expect(rowTitles(wrapper)).toEqual([
      'poster_template title',
      'mural_template title',
      'banner_template title',
      'Build it with the agent'
    ])
    expect(wrapper.text()).toContain('Also try')
    await wrapper.get('[data-testid="home-template-search-row-also"]').trigger('click')
    await flushPromises()
    expect(open.mock.calls[0]![1]).toMatchObject({ kind: 'also', position: 2, best: false })
  })

  it('labels partner templates and the ones that need a download', async () => {
    const partner = candidate('api_partner_template', { partner: true })
    search.mockResolvedValue(answer({ run: [partner], download: [MURAL] }))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster for a bake sale')

    const [first, second] = wrapper.findAll('[role="option"]')
    expect(first!.find('[data-testid="home-template-search-partner"]').text()).toBe('Partner')
    expect(first!.find('[data-testid="home-template-search-needs-download"]').exists()).toBe(false)
    expect(second!.find('[data-testid="home-template-search-partner"]').exists()).toBe(false)
    expect(second!.find('[data-testid="home-template-search-needs-download"]').text()).toBe(
      'Needs download'
    )
  })

  it('labels templates whose prompt the service would rewrite', async () => {
    search.mockResolvedValue(
      answer({ run: [candidate('poster_template', { rewrite: true }), BANNER] })
    )
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')

    const [first, second] = wrapper.findAll('[role="option"]')
    expect(first!.find('[data-testid="home-template-search-rewrite"]').text()).toBe(
      'Rewrites prompt'
    )
    expect(second!.find('[data-testid="home-template-search-rewrite"]').exists()).toBe(false)
  })

  it('shows how well each template matches, and greys out the weaker ones', async () => {
    const weak = candidate('weak_template', { score: 0.3, belowThreshold: true })
    const good = candidate('good_template', { score: 0.6 })
    search.mockResolvedValue(answer({ run: [POSTER, good], alsoTry: [weak] }))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')

    const matches = wrapper
      .findAll('[data-testid="home-template-search-match"]')
      .map((badge) => badge.text())
    expect(matches).toEqual(['Strong match · 92%', 'Good match · 60%', 'Weaker match · 30%'])
    const [strongRow, goodRow, weakRow] = wrapper.findAll('[role="option"]')
    expect(strongRow!.attributes('data-weak')).toBeUndefined()
    expect(goodRow!.attributes('data-weak')).toBeUndefined()
    expect(weakRow!.attributes('data-weak')).toBe('true')
  })

  it('shows the template family under its title', async () => {
    search.mockResolvedValue(
      answer({ run: [candidate('poster_template', { family: 'text-to-image' })] })
    )
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')

    expect(wrapper.findAll('[role="option"]')[0]!.text()).toContain('text-to-image')
  })

  it('searches again when what it searches over changes', async () => {
    const wrapper = mountSearch(null, 'cloud')
    await searchFor(wrapper, 'a poster for a bake sale')
    await wrapper.setProps({ refreshKey: 'local' })
    await flushPromises()

    expect(search).toHaveBeenCalledTimes(2)
    expect(search).toHaveBeenLastCalledWith('a poster for a bake sale')
  })

  it('marks the first template as the best match', async () => {
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster for a bake sale')

    const best = wrapper.findAll('[data-testid="home-template-search-best"]')
    expect(best).toHaveLength(1)
    expect(wrapper.findAll('[role="option"]')[0]!.text()).toContain('Best match')
  })

  it('opens the best template when Enter is pressed on its result', async () => {
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster for a bake sale')
    await wrapper.get('[data-testid="home-template-search-input"]').trigger('keydown', {
      key: 'Enter'
    })
    await flushPromises()

    expect(search).toHaveBeenCalledTimes(1)
    expect(opened()).toEqual(['poster_template'])
    expect(wrapper.find('[data-testid="home-template-search-results"]').exists()).toBe(false)
  })

  it('opens the template picked with the arrow keys', async () => {
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster for a bake sale')
    const input = wrapper.get('[data-testid="home-template-search-input"]')
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(opened()).toEqual(['mural_template'])
    expect(open.mock.calls[0]![1]).toEqual({
      query: 'a poster for a bake sale',
      kind: 'download',
      position: 2,
      best: false
    })
  })

  it('opens a template when its result is clicked', async () => {
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster for a bake sale')
    await wrapper.findAll('[data-testid="home-template-search-row-run"]')[1]!.trigger('click')
    await flushPromises()

    expect(opened()).toEqual(['banner_template'])
  })

  it('says so and keeps the results open when the template cannot be opened', async () => {
    open.mockResolvedValue(false)
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster for a bake sale')
    await wrapper.findAll('[data-testid="home-template-search-row-run"]')[0]!.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="home-template-search-results"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="home-template-search-open-failed"]').exists()).toBe(true)
  })

  it('puts the agent first when the request needs it, and does not run it yet', async () => {
    search.mockResolvedValue(answer({ outcome: 'agent', run: [BANNER] }))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'how do I train a lora on my sketches?')

    const [agent] = wrapper.findAll('[role="option"]')
    expect(agent!.attributes('data-testid')).toBe('home-template-search-row-agent')
    expect(agent!.attributes('aria-disabled')).toBe('true')
    await agent!.trigger('click')
    await flushPromises()
    expect(open).not.toHaveBeenCalled()
  })

  it('shows the service reply instead of results for input it cannot use', async () => {
    search.mockResolvedValue(
      answer({ outcome: 'bad_input', reply: 'Say what you want to make.', run: [BANNER] })
    )
    const wrapper = mountSearch()
    await searchFor(wrapper, '???')

    expect(wrapper.get('[data-testid="home-template-search-reply"]').text()).toBe(
      'Say what you want to make.'
    )
    expect(wrapper.findAll('[role="option"]')).toHaveLength(0)
  })

  it('says the search is not answering when it fails', async () => {
    search.mockResolvedValue({ kind: 'failed' })
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster for a bake sale')

    expect(wrapper.find('[data-testid="home-template-search-failed"]').exists()).toBe(true)
  })

  it('shows why templates cannot run and does not open them', async () => {
    const wrapper = mountSearch('Install a local build to run templates')
    await searchFor(wrapper, 'a poster for a bake sale')
    await wrapper.findAll('[data-testid="home-template-search-row-run"]')[0]!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Install a local build to run templates')
    expect(open).not.toHaveBeenCalled()
  })

  it('searches by itself once typing pauses', async () => {
    vi.useFakeTimers()
    const wrapper = mountSearch()
    await wrapper.get('[data-testid="home-template-search-input"]').setValue('a poster')
    expect(search).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()

    expect(search).toHaveBeenCalledWith('a poster')
    expect(wrapper.findAll('[role="option"]').length).toBeGreaterThan(0)
  })

  it('shows only the answer to the latest request when an older one arrives late', async () => {
    let answerFirst: (response: TemplateSearchResponse) => void = () => {}
    search.mockImplementationOnce(() => new Promise((resolve) => (answerFirst = resolve)))
    search.mockResolvedValueOnce(answer({ run: [BANNER] }))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    await searchFor(wrapper, 'a banner')
    answerFirst(answer({ run: [POSTER] }))
    await flushPromises()

    expect(rowTitles(wrapper)).toEqual(['banner_template title', 'Build it with the agent'])
  })

  it('closes the results on Escape', async () => {
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster for a bake sale')
    await wrapper.get('[data-testid="home-template-search-input"]').trigger('keydown', {
      key: 'Escape'
    })

    expect(wrapper.find('[data-testid="home-template-search-results"]').exists()).toBe(false)
  })
})

describe('TemplateSearchResults as a grid', () => {
  async function mountGrid(result: Partial<TemplateSearchResult>) {
    search.mockResolvedValue(answer(result))
    const scope = effectScope()
    const controller = scope.run(() =>
      useTemplateSearch({
        client: () => ({ search, open }),
        blockedReason: () => null,
        refreshKey: () => ''
      })
    )!
    await controller.search('a poster')
    const wrapper = mount(TemplateSearchResults, {
      props: { controller, layout: 'grid', listboxId: 'grid' },
      attachTo: document.body
    })
    return { wrapper, stop: () => scope.stop() }
  }

  it('puts the match as a coloured percentage in the corner of each picture', async () => {
    const weak = candidate('weak_template', { score: 0.06, belowThreshold: true })
    const { wrapper, stop } = await mountGrid({ run: [POSTER], alsoTry: [weak] })

    const boxes = wrapper.findAll('[data-testid="home-template-search-match"]')
    expect(boxes.map((box) => box.text())).toEqual(['92%', '6%'])
    expect(boxes.map((box) => box.attributes('data-level'))).toEqual(['strong', 'weak'])
    expect(boxes[1]!.attributes('aria-label')).toBe('Weaker match · 6%')
    stop()
  })

  it('shows partner, download and rewrite labels on the picture', async () => {
    const partner = candidate('api_partner_template', { partner: true, rewrite: true })
    const { wrapper, stop } = await mountGrid({ run: [partner], download: [MURAL] })

    const [first, second] = wrapper.findAll('[role="option"]')
    const picture = (card: typeof first) => card!.find('.aspect-\\[4\\/3\\]')
    expect(picture(first).find('[data-testid="home-template-search-partner"]').text()).toBe(
      'Partner'
    )
    expect(picture(first).find('[data-testid="home-template-search-rewrite"]').text()).toBe(
      'Rewrites prompt'
    )
    expect(
      picture(second).find('[data-testid="home-template-search-needs-download"]').exists()
    ).toBe(true)
    stop()
  })
})
