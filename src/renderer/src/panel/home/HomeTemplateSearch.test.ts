import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { page as browserPage, userEvent } from 'vitest/browser'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import '../../assets/main.css'

import HomeTemplateSearch from './HomeTemplateSearch.vue'
import { SEARCH_DELAY_MS } from './useTemplateSearch'
import { verticalNeighbour } from './templateSearch'
import { TEMPLATE_SEARCH_MAX_QUERY } from '../../../../shared/templateSearch'
import { TELEMETRY_ACTION_EVENT_NAME, type TelemetryActionEventDetail } from '../../lib/telemetry'
import type {
  OpenTemplateOutcome,
  TemplateSearchAvailability,
  TemplateSearchCandidate,
  TemplateSearchResponse,
  TemplateSearchResult
} from '../../types/ipc'

const searchTemplates = vi.fn<(query: string, buildId: string) => Promise<TemplateSearchResponse>>()
const openTemplateInBuild =
  vi.fn<(buildId: string, templateId: string) => Promise<OpenTemplateOutcome>>()
const prepare = vi.fn<() => Promise<void>>()
const download = vi.fn<() => Promise<void>>()
const getAuthStatus = vi.fn<() => Promise<{ signedIn: boolean }>>()
const signIn = vi.fn<() => Promise<{ signedIn: boolean }>>()
const settingsStore = new Map<string, unknown>()
const setSetting = vi.fn(async (key: string, value: unknown) => {
  settingsStore.set(key, value)
  settingChanged({ key })
})
let announce: (availability: TemplateSearchAvailability) => void = () => {}
let settingChanged: (change: { key: string }) => void = () => {}

function candidate(
  templateId: string,
  over: Partial<TemplateSearchCandidate> = {}
): TemplateSearchCandidate {
  return {
    templateId,
    title: `${templateId} title`,
    thumbnailUrl: null,
    family: null,
    partner: false,
    needsDownload: false,
    score: 0.92,
    calibrated: null,
    belowThreshold: false,
    needs: [],
    downloadBytes: null,
    ...over
  }
}

const POSTER = candidate('poster_template')
const BANNER = candidate('banner_template')
const MURAL = candidate('mural_template', { needsDownload: true })
const PARTNER_POSTER = candidate('api_poster_template', { partner: true })

function answer(result: Partial<TemplateSearchResult>): TemplateSearchResponse {
  return {
    kind: 'result',
    result: {
      outcome: 'template',
      reply: null,
      run: [],
      download: [],
      alsoTry: [],
      more: [],
      partnerSwitch: false,
      matched: null,
      partnersShown: true,
      ...result
    }
  }
}

function unavailable(availability: TemplateSearchAvailability): TemplateSearchResponse {
  return { kind: 'unavailable', availability }
}

beforeAll(() => browserPage.viewport(1440, 900))

beforeEach(() => {
  vi.clearAllMocks()
  searchTemplates.mockResolvedValue(answer({ run: [POSTER, BANNER], download: [MURAL] }))
  openTemplateInBuild.mockResolvedValue('launch')
  prepare.mockResolvedValue()
  download.mockResolvedValue()
  getAuthStatus.mockResolvedValue({ signedIn: true })
  signIn.mockResolvedValue({ signedIn: true })
  setActivePinia(createPinia())
  settingsStore.clear()
  ;(window as unknown as { api: unknown }).api = {
    comfybuilder: { getAuthStatus, signIn, onAuthChanged: () => () => {} },
    getSetting: async (key: string) => settingsStore.get(key),
    setSetting,
    onSettingsChanged: (callback: (change: { key: string }) => void) => {
      settingChanged = callback
      return () => {
        settingChanged = () => {}
      }
    },
    searchTemplates,
    openTemplateInBuild,
    prepareTemplateSearch: prepare,
    downloadTemplateSearch: download,
    onTemplateSearchAvailability: (
      callback: (availability: TemplateSearchAvailability) => void
    ) => {
      announce = callback
      return () => {
        announce = () => {}
      }
    }
  }
})

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount()
  while (hosts.length) hosts.pop()?.remove()
  vi.useRealTimers()
})

const mounted: ReturnType<typeof mountSearch>[] = []
const hosts: HTMLElement[] = []
const BAR_WIDTH_PX = 720
const PAGE_HEIGHT_PX = 600

function mountSearch(buildId: string | null = 'build-1') {
  const host = document.body.appendChild(document.createElement('div'))
  host.style.width = `${BAR_WIDTH_PX}px`
  host.style.height = `${PAGE_HEIGHT_PX}px`
  host.style.overflowY = 'auto'
  host.dataset.testPage = ''
  hosts.push(host)
  const wrapper = mount(HomeTemplateSearch, { props: { buildId }, attachTo: host })
  mounted.push(wrapper)
  return wrapper
}

type Wrapper = ReturnType<typeof mountSearch>

function input(wrapper: Wrapper) {
  return wrapper.get('[data-testid="home-template-search-input"]')
}

async function searchFor(wrapper: Wrapper, text: string) {
  await input(wrapper).setValue(text)
  await input(wrapper).trigger('keydown', { key: 'Enter' })
  await flushPromises()
}

function rowTitles(wrapper: Wrapper): string[] {
  return wrapper.findAll('[role="option"]').map((row) => row.find('.font-medium').text())
}

function opened(): string[] {
  return openTemplateInBuild.mock.calls.map(([, templateId]) => templateId)
}

function notice(wrapper: Wrapper): string {
  return wrapper.get('[data-testid="home-template-search-notice"]').text()
}

function panel(wrapper: Wrapper) {
  return wrapper.find('[data-testid="home-template-search-results"]')
}

function page(wrapper: Wrapper): HTMLElement {
  return wrapper.element.closest<HTMLElement>('[data-test-page]')!
}

describe('HomeTemplateSearch results', () => {
  it('lists the templates to run, then the ones to download, then Also try', async () => {
    searchTemplates.mockResolvedValue(
      answer({ run: [POSTER], download: [MURAL], alsoTry: [candidate('card_template')] })
    )
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster for a bake sale')

    expect(rowTitles(wrapper)).toEqual([
      'poster_template title',
      'mural_template title',
      'card_template title'
    ])
    expect(wrapper.findAll('[role="option"]').map((row) => row.attributes('data-testid'))).toEqual([
      'home-template-search-row-run',
      'home-template-search-row-download',
      'home-template-search-row-also'
    ])
  })

  it('labels partner templates, and marks a template that needs a download', async () => {
    searchTemplates.mockResolvedValue(
      answer({ run: [candidate('api_poster', { partner: true })], download: [MURAL] })
    )
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')

    const [partner, mural] = wrapper.findAll('[role="option"]')
    expect(partner!.find('[data-testid="home-template-search-partner"]').exists()).toBe(true)
    expect(partner!.find('[data-testid="home-template-search-needs-download"]').exists()).toBe(
      false
    )
    expect(mural!.get('[data-testid="home-template-search-needs-download"]').text()).toBe(
      'Needs download'
    )
  })

  it('shows the calibrated match as a percentage, and the level word alone without one', async () => {
    searchTemplates.mockResolvedValue(
      answer({
        run: [candidate('calibrated', { calibrated: 0.734 }), candidate('raw', { score: 0.6 })]
      })
    )
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')

    const matches = wrapper
      .findAll('[data-testid="home-template-search-match"]')
      .map((b) => b.text())
    expect(matches).toEqual(['73% match', 'Good match'])
  })

  it('greys out a template below the bar and calls it a weaker match', async () => {
    searchTemplates.mockResolvedValue(
      answer({ run: [POSTER], alsoTry: [candidate('weak', { belowThreshold: true, score: 0.3 })] })
    )
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')

    const weak = wrapper.findAll('[role="option"]')[1]!
    expect(weak.attributes('data-weak')).toBe('true')
    expect(weak.get('[data-testid="home-template-search-match"]').text()).toBe('Weaker match')
  })

  it('leaves out matches below the bar under 5%, judged on the calibrated value when there is one', async () => {
    searchTemplates.mockResolvedValue(
      answer({
        run: [POSTER],
        alsoTry: [
          candidate('raw_high_calibrated_low', {
            belowThreshold: true,
            score: 0.3,
            calibrated: 0.02
          }),
          candidate('raw_low', { belowThreshold: true, score: 0.02 }),
          candidate('raw_low_calibrated_high', {
            belowThreshold: true,
            score: 0.02,
            calibrated: 0.3
          }),
          candidate('clears_with_low_score', { score: 0.01 })
        ]
      })
    )
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')

    expect(rowTitles(wrapper)).toEqual([
      'poster_template title',
      'raw_low_calibrated_high title',
      'clears_with_low_score title'
    ])
  })

  it('shows run and download cards in one grid, with only Also try set apart, and marks only partner templates as partner', async () => {
    searchTemplates.mockResolvedValue(
      answer({
        run: [POSTER, candidate('api_poster', { partner: true })],
        download: [MURAL],
        alsoTry: [candidate('card_template'), candidate('flyer_template')]
      })
    )
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    expect(wrapper.get('h2').text()).toBe('Templates')
    expect(
      wrapper.findAll('[role="listbox"] [role="presentation"]').map((header) => header.text())
    ).toEqual(['Also try'])
    expect(wrapper.find('[data-testid="home-template-search-row-action"]').exists()).toBe(false)
    const partnerRows = wrapper
      .findAll('[role="option"]')
      .filter((row) => row.find('[data-testid="home-template-search-partner"]').exists())
    expect(partnerRows.map((row) => row.find('.font-medium').text())).toEqual(['api_poster title'])
  })

  it('calls a strong uncalibrated match strong, and shows no match for a result without a score', async () => {
    searchTemplates.mockResolvedValue(
      answer({ run: [candidate('strong', { score: 0.9 }), candidate('unscored', { score: null })] })
    )
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    const [strong, unscored] = wrapper.findAll('[role="option"]')
    expect(strong!.get('[data-testid="home-template-search-match"]').text()).toBe('Strong match')
    expect(unscored!.find('[data-testid="home-template-search-match"]').exists()).toBe(false)
  })

  it('says it is finding templates while a search runs', async () => {
    searchTemplates.mockReturnValueOnce(new Promise(() => {}))
    const wrapper = mountSearch()
    await input(wrapper).setValue('a poster')
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(notice(wrapper)).toContain('Finding templates')
  })

  it('shows the template family under its title', async () => {
    searchTemplates.mockResolvedValue(answer({ run: [candidate('poster', { family: 'Image' })] }))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    expect(wrapper.get('[role="option"]').text()).toContain('Image')
  })

  it('marks the first template the search chose as the best match', async () => {
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    const best = wrapper.findAll('[data-testid="home-template-search-best"]')
    expect(best).toHaveLength(1)
    expect(
      wrapper
        .findAll('[role="option"]')[0]!
        .find('[data-testid="home-template-search-best"]')
        .exists()
    ).toBe(true)
  })

  it('marks the first download as the best match when the answer is to download one', async () => {
    searchTemplates.mockResolvedValue(
      answer({ outcome: 'download', run: [BANNER], download: [MURAL] })
    )
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a mural')
    const [mural, banner] = wrapper.findAll('[role="option"]')
    expect(mural!.find('[data-testid="home-template-search-best"]').exists()).toBe(true)
    expect(banner!.find('[data-testid="home-template-search-best"]').exists()).toBe(false)
  })

  it('shows every card of a model-name lookup under the names it matched, with no match figure or best match', async () => {
    const unscored = (id: string, over: Partial<TemplateSearchCandidate> = {}) =>
      candidate(id, { score: null, ...over })
    searchTemplates.mockResolvedValue(
      answer({
        matched: ['qwen 2.1', 'kling'],
        run: [unscored('qwen_a'), unscored('qwen_b')],
        download: [unscored('kling_a', { needsDownload: true })]
      })
    )
    const wrapper = mountSearch()
    await searchFor(wrapper, 'qwen 2.1 kling')
    expect(wrapper.get('h2').text()).toBe('Templates for qwen 2.1 and kling')
    expect(rowTitles(wrapper)).toEqual(['qwen_a title', 'qwen_b title', 'kling_a title'])
    expect(wrapper.find('[data-testid="home-template-search-match"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="home-template-search-best"]').exists()).toBe(false)
    expect(wrapper.get('[role="option"][aria-selected="true"]').text()).toContain('qwen_a title')
  })

  it('leads a model-name lookup with the card the search puts first, even a download, with no best match', async () => {
    searchTemplates.mockResolvedValue(
      answer({
        outcome: 'download',
        matched: ['wan 2.2'],
        run: [candidate('wan_installed', { score: null })],
        download: [candidate('wan_lead', { score: null, needsDownload: true })]
      })
    )
    const wrapper = mountSearch()
    await searchFor(wrapper, 'wan 2.2')
    expect(rowTitles(wrapper)).toEqual(['wan_lead title', 'wan_installed title'])
    expect(wrapper.find('[data-testid="home-template-search-best"]').exists()).toBe(false)
  })

  it('lets the heading row grow with a long list of names instead of running into the cards', async () => {
    searchTemplates.mockResolvedValue(
      answer({
        matched: ['qwen 2.1', 'kling', 'wan 2.2', 'flux 2 klein', 'ltx 2', 'hunyuan 3', 'seedance'],
        run: [candidate('qwen_a', { score: null })],
        partnerSwitch: true
      })
    )
    const wrapper = mountSearch()
    page(wrapper).style.width = '400px'
    await searchFor(wrapper, 'qwen 2.1 kling')
    const heading = wrapper.get('h2').element.getBoundingClientRect()
    expect(heading.height, 'the names wrap').toBeGreaterThan(24)
    expect(
      wrapper.get('[role="option"]').element.getBoundingClientRect().top
    ).toBeGreaterThanOrEqual(heading.bottom)
  })

  it('says which files a template needs, one chip per kind', async () => {
    searchTemplates.mockResolvedValue(
      answer({
        matched: ['wan 2.2'],
        run: [
          candidate('flf', { score: null, needs: ['image', 'image'] }),
          candidate('v2v', { score: null, needs: ['video', 'audio'] }),
          candidate('t2v', { score: null })
        ]
      })
    )
    const wrapper = mountSearch()
    await searchFor(wrapper, 'wan 2.2')
    expect(
      wrapper
        .findAll('[role="option"]')
        .map((card) =>
          card
            .findAll('[data-testid="home-template-search-needs-input"]')
            .map((chip) => chip.text())
        )
    ).toEqual([['Needs 2 images'], ['Needs a video', 'Needs audio'], []])
  })

  it("puts the best match's whole family first when the answer is to download it", async () => {
    searchTemplates.mockResolvedValue(
      answer({
        outcome: 'download',
        run: [candidate('poster', { family: 'poster' })],
        download: [candidate('mural', { family: 'mural', needsDownload: true })],
        more: [
          candidate('poster_b', { family: 'poster' }),
          candidate('mural_b', { family: 'mural' })
        ]
      })
    )
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a mural')
    expect(rowTitles(wrapper)).toEqual([
      'mural title',
      'mural_b title',
      'poster title',
      'poster_b title'
    ])
    expect(wrapper.get('[role="option"][aria-selected="true"]').text()).toContain('mural title')
  })

  it("follows each family's cards with its further templates, marking the ones that need a download", async () => {
    searchTemplates.mockResolvedValue(
      answer({
        run: [candidate('poster', { family: 'poster' }), candidate('banner', { family: 'banner' })],
        download: [candidate('mural', { family: 'mural', needsDownload: true })],
        more: [
          candidate('poster_b', { family: 'poster' }),
          candidate('banner_b', { family: 'banner', needsDownload: true }),
          candidate('mural_b', { family: 'mural' })
        ]
      })
    )
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    expect(rowTitles(wrapper)).toEqual([
      'poster title',
      'poster_b title',
      'banner title',
      'banner_b title',
      'mural title',
      'mural_b title'
    ])
    const cards = wrapper.findAll('[role="option"]')
    expect(cards[3]!.find('[data-testid="home-template-search-needs-download"]').exists()).toBe(
      true
    )
    const matchShown = cards.map((card) =>
      card.find('[data-testid="home-template-search-match"]').exists()
    )
    expect(matchShown, 'the search scores families, so only the family pick shows it').toEqual([
      true,
      false,
      true,
      false,
      true,
      false
    ])
  })

  it("keeps a family's open template right after its pick, ahead of the next family, with the match figure on the pick only", async () => {
    searchTemplates.mockResolvedValue(
      answer({
        run: [
          candidate('api_gpt', { partner: true, family: 'graphic' }),
          candidate('api_nano', { partner: true, family: 'stylised' })
        ],
        download: [
          candidate('mural', { needsDownload: true }),
          candidate('qwen', { family: 'graphic', needsDownload: true }),
          candidate('krea', { family: 'stylised', needsDownload: true }),
          candidate('flyer', { family: 'flyer', needsDownload: true }),
          candidate('zine', { needsDownload: true })
        ]
      })
    )
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    expect(rowTitles(wrapper), 'cards with no family keep their place').toEqual([
      'api_gpt title',
      'qwen title',
      'api_nano title',
      'krea title',
      'mural title',
      'flyer title',
      'zine title'
    ])
    expect(
      wrapper
        .findAll('[role="option"]')
        .map((card) => card.find('[data-testid="home-template-search-match"]').exists())
    ).toEqual([true, false, true, false, true, true, true])
  })

  it('shows the reply and suggestions, with nothing marked best, when the request needs the agent', async () => {
    searchTemplates.mockResolvedValue(
      answer({ outcome: 'agent', reply: 'This needs the agent.', run: [BANNER], alsoTry: [POSTER] })
    )
    const wrapper = mountSearch()
    await searchFor(wrapper, 'edit my last video')
    expect(wrapper.get('[data-testid="home-template-search-reply"]').text()).toBe(
      'This needs the agent.'
    )
    expect(rowTitles(wrapper)).toEqual(['banner_template title', 'poster_template title'])
    expect(wrapper.find('[data-testid="home-template-search-best"]').exists()).toBe(false)

    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(opened()).toEqual(['banner_template'])
  })

  it('shows only the reply for input the search cannot use', async () => {
    searchTemplates.mockResolvedValue(
      answer({ outcome: 'bad_input', reply: 'Say what you want to make.', alsoTry: [POSTER] })
    )
    const wrapper = mountSearch()
    await searchFor(wrapper, 'asdf')
    expect(wrapper.get('[data-testid="home-template-search-reply"]').text()).toBe(
      'Say what you want to make.'
    )
    expect(wrapper.findAll('[role="option"]')).toHaveLength(0)
  })

  it('says nothing fits when the search finds nothing and has no reply', async () => {
    searchTemplates.mockResolvedValue(answer({ outcome: 'unsat' }))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a sculpture made of fog')
    expect(wrapper.get('[data-testid="home-template-search-no-match"]').text()).toBe(
      'No template fits this yet.'
    )
  })

  it('says the search is not answering when it fails', async () => {
    searchTemplates.mockResolvedValue({ kind: 'failed' })
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    expect(notice(wrapper)).toContain("isn't answering")
  })

  it('keeps a request within the length search accepts', () => {
    const wrapper = mountSearch()
    expect(input(wrapper).attributes('maxlength')).toBe(String(TEMPLATE_SEARCH_MAX_QUERY))
  })
})

describe('HomeTemplateSearch opening a template', () => {
  it('opens the best template when Enter is pressed on its result', async () => {
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(opened()).toEqual(['poster_template'])
    expect(panel(wrapper).exists()).toBe(false)
  })

  it('opens the card picked with the arrow keys', async () => {
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    await input(wrapper).trigger('keydown', { key: 'ArrowDown' })
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(opened()).toEqual(['banner_template'])
  })

  it('keeps focus in the bar when a result is pressed, so the click can open it', async () => {
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    const row = wrapper.findAll('[role="option"]')[2]!
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    row.element.dispatchEvent(press)
    expect(press.defaultPrevented).toBe(true)

    await row.trigger('click')
    await flushPromises()
    expect(opened()).toEqual(['mural_template'])
  })

  it('tells Home the build the template went to, even if the build changes meanwhile', async () => {
    let finishOpen!: (outcome: OpenTemplateOutcome) => void
    openTemplateInBuild.mockReturnValueOnce(new Promise((resolve) => (finishOpen = resolve)))
    const wrapper = mountSearch('build-1')
    await searchFor(wrapper, 'a poster')
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await wrapper.setProps({ buildId: 'build-2' })
    finishOpen('launch')
    await flushPromises()
    expect(wrapper.emitted('opened')).toEqual([['build-1']])
  })

  it('does not open the highlighted template on Enter once the results are closed', async () => {
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    await wrapper.get('[data-testid="home-template-search"]').trigger('keydown', { key: 'Escape' })
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(openTemplateInBuild).not.toHaveBeenCalled()
    expect(panel(wrapper).exists()).toBe(true)

    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(opened()).toEqual(['poster_template'])
  })

  it('starts on the best match when the answer is to download one', async () => {
    searchTemplates.mockResolvedValue(
      answer({ outcome: 'download', run: [BANNER], download: [MURAL] })
    )
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a mural')
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(opened()).toEqual(['mural_template'])
  })

  it('moves the highlight up from the first row of cards to the nearest card of the last', async () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map((letter) => candidate(`card_${letter}`))
    searchTemplates.mockResolvedValue(answer({ run: five }))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a birthday card')
    await input(wrapper).trigger('keydown', { key: 'ArrowUp' })
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(opened()).toEqual(['card_d'])
  })

  it('searches again for the new build, and opens in the build the results are for', async () => {
    const wrapper = mountSearch('build-1')
    await searchFor(wrapper, 'a poster')
    searchTemplates.mockClear()

    await wrapper.setProps({ buildId: 'build-2' })
    await flushPromises()
    expect(searchTemplates).toHaveBeenCalledWith('a poster', 'build-2')

    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(openTemplateInBuild).toHaveBeenCalledWith('build-2', 'poster_template')
  })

  it('searches again on ArrowDown after the build changed while the results were closed', async () => {
    const wrapper = mountSearch('build-1')
    await searchFor(wrapper, 'a poster')
    await wrapper.get('[data-testid="home-template-search"]').trigger('keydown', { key: 'Escape' })
    searchTemplates.mockClear()
    await wrapper.setProps({ buildId: 'build-2' })
    await flushPromises()

    await input(wrapper).trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    expect(searchTemplates).toHaveBeenCalledWith('a poster', 'build-2')
    expect(panel(wrapper).exists()).toBe(true)
  })

  it('drops an answer for the old build that arrives after the results closed and the build changed', async () => {
    const wrapper = mountSearch('build-1')
    await searchFor(wrapper, 'a poster')
    let answerOld!: (value: TemplateSearchResponse) => void
    searchTemplates.mockReturnValueOnce(new Promise((resolve) => (answerOld = resolve)))
    await searchFor(wrapper, 'a banner')
    await wrapper.get('[data-testid="home-template-search"]').trigger('keydown', { key: 'Escape' })
    await wrapper.setProps({ buildId: 'build-2' })
    answerOld(answer({ run: [BANNER] }))
    await flushPromises()
    searchTemplates.mockClear()

    await input(wrapper).trigger('focus')
    await flushPromises()
    expect(searchTemplates).toHaveBeenCalledWith('a banner', 'build-2')
  })

  it('cancels a typed search still waiting when the build changes while the results are closed', async () => {
    vi.useFakeTimers()
    const wrapper = mountSearch('build-1')
    await searchFor(wrapper, 'a poster')
    await input(wrapper).setValue('a banner')
    await wrapper.get('[data-testid="home-template-search"]').trigger('keydown', { key: 'Escape' })
    searchTemplates.mockClear()

    await wrapper.setProps({ buildId: 'build-2' })
    await vi.advanceTimersByTimeAsync(SEARCH_DELAY_MS)
    expect(searchTemplates).not.toHaveBeenCalled()
  })

  it('keeps the answer and the highlight when the bar takes focus again', async () => {
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    await input(wrapper).trigger('keydown', { key: 'ArrowDown' })
    searchTemplates.mockClear()

    await input(wrapper).trigger('focus')
    await flushPromises()
    expect(searchTemplates).not.toHaveBeenCalled()
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(opened()).toEqual(['banner_template'])
  })

  it('starts on the first row of a new answer that has no best match', async () => {
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    await input(wrapper).trigger('keydown', { key: 'ArrowDown' })
    searchTemplates.mockResolvedValue(
      answer({ outcome: 'agent', reply: 'This needs the agent.', run: [BANNER], alsoTry: [POSTER] })
    )
    await searchFor(wrapper, 'edit my last video')

    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(opened()).toEqual(['banner_template'])
  })

  it('forgets the answer for the old build while the results are closed, and searches again on focus', async () => {
    const wrapper = mountSearch('build-1')
    await searchFor(wrapper, 'a poster')
    await wrapper.get('[data-testid="home-template-search"]').trigger('keydown', { key: 'Escape' })
    searchTemplates.mockClear()

    await wrapper.setProps({ buildId: 'build-2' })
    await flushPromises()
    expect(searchTemplates).not.toHaveBeenCalled()
    expect(panel(wrapper).exists()).toBe(false)

    await input(wrapper).trigger('focus')
    await flushPromises()
    expect(searchTemplates).toHaveBeenCalledWith('a poster', 'build-2')
    expect(rowTitles(wrapper)).toContain('poster_template title')
  })

  it('searches the new text instead of opening an answer to older text', async () => {
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    searchTemplates.mockClear()

    await input(wrapper).setValue('a banner')
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(openTemplateInBuild).not.toHaveBeenCalled()
    expect(searchTemplates).toHaveBeenCalledWith('a banner', 'build-1')
  })

  it('does nothing on the Enter that ends an IME composition', async () => {
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    searchTemplates.mockClear()
    await input(wrapper).trigger('keydown', { key: 'Enter', isComposing: true })
    await flushPromises()
    expect(openTemplateInBuild).not.toHaveBeenCalled()
    expect(searchTemplates).not.toHaveBeenCalled()
  })

  it('says so and keeps the results open when the template cannot be opened', async () => {
    openTemplateInBuild.mockResolvedValue('refused')
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    await wrapper.findAll('[role="option"]')[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="home-template-search-open-failed"]').exists()).toBe(true)
    expect(panel(wrapper).exists()).toBe(true)
  })

  it('says it could not open a template when there is no local build to open it in', async () => {
    const wrapper = mountSearch(null)
    await searchFor(wrapper, 'a poster')
    await wrapper.findAll('[role="option"]')[0]!.trigger('click')
    await flushPromises()
    expect(openTemplateInBuild).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="home-template-search-open-failed"]').exists()).toBe(true)
  })

  it.each(['launch', 'opened'] as const)(
    'tells Home a template is on its way when the build answers %s',
    async (outcome) => {
      openTemplateInBuild.mockResolvedValue(outcome)
      const wrapper = mountSearch()
      await searchFor(wrapper, 'a poster')
      await wrapper.findAll('[role="option"]')[0]!.trigger('click')
      await flushPromises()
      expect(openTemplateInBuild).toHaveBeenCalledWith('build-1', 'poster_template')
      expect(wrapper.emitted('opened')).toEqual([['build-1']])
    }
  )
})

describe('HomeTemplateSearch cards', () => {
  const CARDS = ['a', 'b', 'c', 'd', 'e'].map((letter) => candidate(`card_${letter}`))

  function inView(wrapper: Wrapper, selector: string): boolean {
    const box = wrapper.get(selector).element.getBoundingClientRect()
    const scroller = page(wrapper).getBoundingClientRect()
    return (
      box.top >= Math.max(scroller.top, 0) - 1 &&
      box.bottom <= Math.min(scroller.bottom, window.innerHeight) + 1
    )
  }

  const SELECTED = '[role="option"][aria-selected="true"]'

  function cardBoxes(wrapper: Wrapper): DOMRect[] {
    return wrapper.findAll('[role="option"]').map((card) => card.element.getBoundingClientRect())
  }

  function highlighted(wrapper: Wrapper): string {
    return wrapper.get('[role="option"][aria-selected="true"]').find('.font-medium').text()
  }

  async function press(wrapper: Wrapper, key: string): Promise<boolean> {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    input(wrapper).element.dispatchEvent(event)
    await flushPromises()
    return event.defaultPrevented
  }

  async function searchCards(wrapper: Wrapper): Promise<void> {
    searchTemplates.mockResolvedValue(answer({ run: CARDS, download: [MURAL] }))
    await searchFor(wrapper, 'a birthday card')
  }

  const MANY = Array.from({ length: 15 }, (_, i) => candidate(`card_${i}`))

  async function searchMany(wrapper: Wrapper): Promise<void> {
    searchTemplates.mockResolvedValue(answer({ run: MANY }))
    await searchFor(wrapper, 'a birthday card')
  }

  it('lays the cards out three across in a page as wide as the bar, the download card in the same grid', async () => {
    const wrapper = mountSearch()
    await searchCards(wrapper)
    const [a, b, c, d, e, mural] = cardBoxes(wrapper)
    expect([b!.top, c!.top]).toEqual([a!.top, a!.top])
    expect(d!.top).toBeGreaterThan(a!.top)
    expect([d!.left, e!.top]).toEqual([a!.left, d!.top])
    expect([mural!.top, mural!.left]).toEqual([d!.top, c!.left])
  })

  it('moves Down and Up to the nearest card in the next row, and wraps', async () => {
    const wrapper = mountSearch()
    await searchCards(wrapper)
    expect(highlighted(wrapper)).toBe('card_a title')

    const downs: string[] = []
    for (let i = 0; i < 3; i++) {
      await press(wrapper, 'ArrowDown')
      downs.push(highlighted(wrapper))
    }
    expect(downs).toEqual(['card_d title', 'card_a title', 'card_d title'])

    const ups: string[] = []
    for (let i = 0; i < 2; i++) {
      await press(wrapper, 'ArrowUp')
      ups.push(highlighted(wrapper))
    }
    expect(ups).toEqual(['card_a title', 'card_d title'])
  })

  it('moves Down from the last column to the nearest card of a shorter row', async () => {
    const wrapper = mountSearch()
    searchTemplates.mockResolvedValue(answer({ run: CARDS }))
    await searchFor(wrapper, 'a birthday card')
    await press(wrapper, 'ArrowDown')
    await press(wrapper, 'ArrowUp')
    await press(wrapper, 'ArrowRight')
    await press(wrapper, 'ArrowRight')
    expect(highlighted(wrapper)).toBe('card_c title')

    await press(wrapper, 'ArrowDown')
    expect(highlighted(wrapper)).toBe('card_e title')
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(opened()).toEqual(['card_e'])
  })

  it('leaves Left and Right to the text cursor until the user arrows into the cards', async () => {
    const wrapper = mountSearch()
    await searchCards(wrapper)
    expect(await press(wrapper, 'ArrowRight')).toBe(false)
    expect(highlighted(wrapper)).toBe('card_a title')

    await press(wrapper, 'ArrowDown')
    expect(await press(wrapper, 'ArrowRight')).toBe(true)
    expect(highlighted(wrapper)).toBe('card_e title')
    expect(await press(wrapper, 'ArrowLeft')).toBe(true)
    expect(highlighted(wrapper)).toBe('card_d title')
  })

  it('moves Left and Right in reading order across rows, wrapping at the ends', async () => {
    const wrapper = mountSearch()
    await searchCards(wrapper)
    await press(wrapper, 'ArrowDown')
    await press(wrapper, 'ArrowUp')
    await press(wrapper, 'ArrowLeft')
    expect(highlighted(wrapper)).toBe('mural_template title')
    expect(page(wrapper).scrollTop).toBeGreaterThan(0)
    expect(inView(wrapper, SELECTED)).toBe(true)
    await press(wrapper, 'ArrowRight')
    await press(wrapper, 'ArrowRight')
    await press(wrapper, 'ArrowRight')
    await press(wrapper, 'ArrowRight')
    expect(highlighted(wrapper)).toBe('card_d title')
  })

  it('moves Up and Down one card at a time when every card is in one row', async () => {
    searchTemplates.mockResolvedValue(answer({ run: [POSTER, BANNER] }))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    await press(wrapper, 'ArrowDown')
    expect(highlighted(wrapper)).toBe('banner_template title')
    await press(wrapper, 'ArrowUp')
    expect(highlighted(wrapper)).toBe('poster_template title')
  })

  it('leaves Left and Right to the text cursor while a new search for the same request is running', async () => {
    const wrapper = mountSearch('build-1')
    await searchCards(wrapper)
    await press(wrapper, 'ArrowDown')
    searchTemplates.mockReturnValueOnce(new Promise(() => {}))
    await wrapper.setProps({ buildId: 'build-2' })
    await flushPromises()
    expect(await press(wrapper, 'ArrowRight')).toBe(false)
  })

  it('gives Left and Right back to the text cursor once the request is edited', async () => {
    const wrapper = mountSearch()
    await searchCards(wrapper)
    await press(wrapper, 'ArrowDown')
    vi.useFakeTimers()
    await input(wrapper).setValue('a birthday card for my aunt')
    expect(await press(wrapper, 'ArrowRight')).toBe(false)
    expect(highlighted(wrapper)).toBe('card_d title')
  })

  it('gives Left and Right back to the text cursor when the results close or the text is clicked', async () => {
    const wrapper = mountSearch()
    await searchCards(wrapper)
    await press(wrapper, 'ArrowDown')
    await wrapper.get('[data-testid="home-template-search"]').trigger('keydown', { key: 'Escape' })
    expect(await press(wrapper, 'ArrowRight')).toBe(false)
    expect(panel(wrapper).exists()).toBe(false)

    await input(wrapper).trigger('focus')
    expect(await press(wrapper, 'ArrowRight')).toBe(false)
    expect(highlighted(wrapper)).toBe('card_d title')

    await press(wrapper, 'ArrowDown')
    await input(wrapper).trigger('mousedown')
    expect(await press(wrapper, 'ArrowRight')).toBe(false)
  })

  it('reopens closed results on Down or Up without moving the highlight', async () => {
    const wrapper = mountSearch()
    await searchCards(wrapper)
    await press(wrapper, 'ArrowDown')
    await wrapper.get('[data-testid="home-template-search"]').trigger('keydown', { key: 'Escape' })
    await press(wrapper, 'ArrowDown')
    expect(highlighted(wrapper)).toBe('card_d title')
    expect(await press(wrapper, 'ArrowRight')).toBe(true)
  })

  it('leaves modified Left and Right, and any arrow during IME composition, to the text box', async () => {
    const wrapper = mountSearch()
    await searchCards(wrapper)
    await press(wrapper, 'ArrowDown')
    for (const init of [
      { shiftKey: true },
      { altKey: true },
      { ctrlKey: true },
      { metaKey: true }
    ]) {
      const event = new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
        ...init
      })
      input(wrapper).element.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }
    for (const key of ['ArrowRight', 'ArrowDown']) {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        isComposing: true
      })
      input(wrapper).element.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }
    await flushPromises()
    expect(highlighted(wrapper)).toBe('card_d title')
  })

  it('highlights a card when the pointer moves over it, not when the panel scrolls under a resting pointer', async () => {
    const wrapper = mountSearch()
    await searchCards(wrapper)
    const cardB = wrapper.findAll('[role="option"]')[1]!
    await cardB.trigger('mouseenter')
    expect(highlighted(wrapper)).toBe('card_a title')
    await cardB.trigger('mousemove')
    expect(highlighted(wrapper)).toBe('card_b title')
  })

  it('keeps focus in the bar for a press anywhere in the results', async () => {
    const wrapper = mountSearch()
    await searchCards(wrapper)
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    wrapper.get('[role="listbox"]').element.dispatchEvent(press)
    expect(press.defaultPrevented).toBe(true)

    input(wrapper).element.focus()
    await userEvent.click(wrapper.get('h2').element)
    expect(document.activeElement).toBe(input(wrapper).element)
  })

  it('keeps the could-not-open message in view when a card lower down could not be opened', async () => {
    openTemplateInBuild.mockResolvedValue('refused')
    const wrapper = mountSearch()
    await searchMany(wrapper)
    await press(wrapper, 'ArrowUp')
    expect(page(wrapper).scrollTop).toBeGreaterThan(0)
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    const message = '[data-testid="home-template-search-open-failed"]'
    expect(inView(wrapper, message)).toBe(true)

    await press(wrapper, 'ArrowUp')
    await press(wrapper, 'ArrowUp')
    expect(highlighted(wrapper)).toBe('card_6 title')
    const card = wrapper.get(SELECTED).element.getBoundingClientRect()
    expect(card.top).toBeGreaterThanOrEqual(
      wrapper.get(message).element.getBoundingClientRect().bottom - 1
    )
  })

  it('brings a first-row card into view past the page scrolling, not only the panel', async () => {
    const spacer = document.body.insertBefore(
      document.createElement('div'),
      document.body.firstChild
    )
    spacer.style.height = '2000px'
    try {
      const wrapper = mountSearch()
      await searchCards(wrapper)
      expect(highlighted(wrapper)).toBe('card_a title')
      const card = wrapper.get(SELECTED).element.getBoundingClientRect()
      expect(card.bottom).toBeLessThanOrEqual(window.innerHeight + 1)
    } finally {
      spacer.remove()
    }
  })

  it('puts the best match first, highlighted, even when the search lists it after other cards', async () => {
    searchTemplates.mockResolvedValue(answer({ outcome: 'download', run: MANY, download: [MURAL] }))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a mural')
    expect(rowTitles(wrapper)[0]).toBe('mural_template title')
    expect(highlighted(wrapper)).toBe('mural_template title')
    expect(inView(wrapper, SELECTED)).toBe(true)
  })

  it('brings the highlighted card back into view when the results reopen', async () => {
    const wrapper = mountSearch()
    await searchMany(wrapper)
    await press(wrapper, 'ArrowUp')
    expect(highlighted(wrapper)).toBe('card_12 title')

    await wrapper.get('[data-testid="home-template-search"]').trigger('keydown', { key: 'Escape' })
    expect(page(wrapper).scrollTop).toBe(0)
    await input(wrapper).trigger('focus')
    await flushPromises()
    expect(highlighted(wrapper)).toBe('card_12 title')
    expect(page(wrapper).scrollTop).toBeGreaterThan(0)
    expect(inView(wrapper, SELECTED)).toBe(true)
  })

  it('fills a page wider than the bar, and keeps a download chip inside its card', async () => {
    const wrapper = mountSearch()
    page(wrapper).style.width = '1120px'
    searchTemplates.mockResolvedValue(
      answer({
        run: CARDS,
        download: [candidate('mural', { needsDownload: true, downloadBytes: 512_000_000 })]
      })
    )
    await searchFor(wrapper, 'a mural')
    const list = wrapper.get('[role="listbox"]').element.getBoundingClientRect()
    expect(list.width).toBeGreaterThan(wrapper.get('label').element.getBoundingClientRect().width)
    expect(list.width).toBeCloseTo(page(wrapper).clientWidth, 0)
    const mural = wrapper.findAll('[role="option"]').at(-1)!
    const chip = mural.get('[data-testid="home-template-search-needs-download"]')
    expect(chip.text()).toContain('about')
    expect(chip.attributes('title')).toBe(chip.text())
    const label = chip.get('.truncate').element
    expect(label.scrollWidth, 'the label is longer than the card has room for').toBeGreaterThan(
      label.clientWidth
    )
    const text = document.createRange()
    text.selectNodeContents(label)
    const glyphs = text.getBoundingClientRect()
    const box = label.getBoundingClientRect()
    expect(glyphs.top, 'nothing above the label is cut').toBeGreaterThanOrEqual(box.top - 0.5)
    expect(glyphs.bottom, 'no descender is cut').toBeLessThanOrEqual(box.bottom + 0.5)
    expect(chip.element.scrollWidth).toBeLessThanOrEqual(chip.element.clientWidth)
    expect(chip.element.getBoundingClientRect().right).toBeLessThanOrEqual(
      mural.element.getBoundingClientRect().right
    )
  })

  it('scrolls back to the top, heading included, when the highlight wraps to the first row', async () => {
    const wrapper = mountSearch()
    await searchMany(wrapper)
    await press(wrapper, 'ArrowUp')
    expect(page(wrapper).scrollTop).toBeGreaterThan(0)
    await press(wrapper, 'ArrowDown')
    expect(highlighted(wrapper)).toBe('card_0 title')
    expect(inView(wrapper, 'h2')).toBe(true)
  })

  it('scrolls the highlighted card into view when the answer is longer than the page', async () => {
    const wrapper = mountSearch()
    await searchMany(wrapper)
    const scroller = page(wrapper)
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight)
    expect(scroller.scrollTop).toBe(0)

    await press(wrapper, 'ArrowUp')
    const card = wrapper.get('[role="option"][aria-selected="true"]').element
    expect(scroller.scrollTop).toBeGreaterThan(0)
    expect(card.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      scroller.getBoundingClientRect().bottom + 1
    )
  })
})

describe('HomeTemplateSearch partner templates', () => {
  function cardAction(wrapper: Wrapper, index: number): string {
    const action = wrapper
      .findAll('[role="option"]')
      [index]!.find('[data-testid="home-template-search-row-action"]')
    return action.exists() ? action.text() : ''
  }

  it('asks a signed-out user to sign in from a partner card, and opens nothing', async () => {
    getAuthStatus.mockResolvedValue({ signedIn: false })
    signIn.mockReturnValue(new Promise(() => {}))
    searchTemplates.mockResolvedValue(answer({ run: [PARTNER_POSTER, POSTER] }))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')

    expect(cardAction(wrapper, 0)).toBe('Sign in to use')
    expect(cardAction(wrapper, 1), 'an open template has no action line').toBe('')
    await wrapper.findAll('[role="option"]')[0]!.trigger('click')
    await flushPromises()
    expect(signIn).toHaveBeenCalledTimes(1)
    expect(opened()).toEqual([])
  })

  it('signs in from the keyboard too, when Enter picks a partner card', async () => {
    getAuthStatus.mockResolvedValue({ signedIn: false })
    signIn.mockReturnValue(new Promise(() => {}))
    searchTemplates.mockResolvedValue(answer({ run: [PARTNER_POSTER] }))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(signIn).toHaveBeenCalledTimes(1)
    expect(opened()).toEqual([])
  })

  it('asks to sign in once for a double-click or a held Enter', async () => {
    getAuthStatus.mockResolvedValue({ signedIn: false })
    signIn.mockReturnValue(new Promise(() => {}))
    searchTemplates.mockResolvedValue(answer({ run: [PARTNER_POSTER] }))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    const card = wrapper.findAll('[role="option"]')[0]!.element
    card.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    card.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }))
    input(wrapper).element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true })
    )
    await flushPromises()
    expect(signIn).toHaveBeenCalledTimes(1)
  })

  it('drops Sign in to use once signed in, and leaves the pick to the user', async () => {
    getAuthStatus.mockResolvedValue({ signedIn: false })
    searchTemplates.mockResolvedValue(answer({ run: [PARTNER_POSTER] }))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    await wrapper.findAll('[role="option"]')[0]!.trigger('click')
    await flushPromises()

    expect(cardAction(wrapper, 0)).toBe('')
    expect(opened()).toEqual([])
    await wrapper.findAll('[role="option"]')[0]!.trigger('click')
    await flushPromises()
    expect(opened()).toEqual(['api_poster_template'])
  })

  it('asks for the sign-in again when a partner card is picked again before it finishes, so a closed browser page comes back', async () => {
    getAuthStatus.mockResolvedValue({ signedIn: false })
    signIn.mockReturnValue(new Promise(() => {}))
    searchTemplates.mockResolvedValue(answer({ run: [PARTNER_POSTER] }))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    await wrapper.findAll('[role="option"]')[0]!.trigger('click')
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(signIn).toHaveBeenCalledTimes(2)
    expect(opened()).toEqual([])
  })

  it('keeps the card as Sign in to use when sign-in is cancelled, and lets the user try again', async () => {
    getAuthStatus.mockResolvedValue({ signedIn: false })
    signIn.mockRejectedValueOnce(new Error('closed the browser'))
    searchTemplates.mockResolvedValue(answer({ run: [PARTNER_POSTER] }))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    await wrapper.findAll('[role="option"]')[0]!.trigger('click')
    await flushPromises()
    expect(cardAction(wrapper, 0)).toBe('Sign in to use')
    expect(opened()).toEqual([])

    await wrapper.findAll('[role="option"]')[0]!.trigger('click')
    await flushPromises()
    expect(signIn).toHaveBeenCalledTimes(2)
  })

  it('shows no Sign in to use on a partner card while the sign-in state is still loading', async () => {
    getAuthStatus.mockReturnValue(new Promise(() => {}))
    searchTemplates.mockResolvedValue(answer({ run: [PARTNER_POSTER] }))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    expect(cardAction(wrapper, 0)).toBe('')
  })

  it('opens a partner card for a signed-in user as before', async () => {
    searchTemplates.mockResolvedValue(answer({ run: [PARTNER_POSTER] }))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    expect(cardAction(wrapper, 0)).toBe('')
    await wrapper.findAll('[role="option"]')[0]!.trigger('click')
    await flushPromises()
    expect(signIn).not.toHaveBeenCalled()
    expect(opened()).toEqual(['api_poster_template'])
  })
})

describe('HomeTemplateSearch open templates and the partner switch', () => {
  function switchButton(wrapper: Wrapper) {
    return wrapper.get('[data-testid="home-template-search-partner-switch"] button')
  }

  it('says roughly how much an open template still needs to download', async () => {
    const open = candidate('krea_template', {
      needsDownload: true,
      downloadBytes: 19_460_000_000
    })
    searchTemplates.mockResolvedValue(answer({ run: [POSTER], download: [open] }))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    const card = wrapper.findAll('[role="option"]')[1]!
    expect(card.get('[data-testid="home-template-search-needs-download"]').text()).toBe(
      'Needs download · about 18 GB'
    )
  })

  it('shows the partner switch only when the search offers it', async () => {
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    expect(wrapper.find('[data-testid="home-template-search-partner-switch"]').exists()).toBe(false)

    searchTemplates.mockResolvedValue(answer({ run: [POSTER], partnerSwitch: true }))
    await searchFor(wrapper, 'a poster again')
    const partnerSwitch = wrapper.get('[data-testid="home-template-search-partner-switch"]')
    expect(partnerSwitch.element.parentElement!.contains(wrapper.get('h2').element)).toBe(true)
  })

  it('saves turning partner templates off from the switch, and shows the answer searched with it', async () => {
    searchTemplates.mockImplementation(async () =>
      answer({
        run: [POSTER],
        partnerSwitch: true,
        partnersShown: settingsStore.get('templateSearchPartners') !== false
      })
    )
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    const calls = searchTemplates.mock.calls.length
    await switchButton(wrapper).trigger('click')
    await flushPromises()

    expect(setSetting).toHaveBeenCalledWith('templateSearchPartners', false)
    expect(searchTemplates).toHaveBeenCalledTimes(calls + 1)
    expect(switchButton(wrapper).attributes('aria-checked')).toBe('false')
  })

  it('shows the switch as the search ran', async () => {
    searchTemplates.mockResolvedValue(
      answer({ run: [POSTER], partnerSwitch: true, partnersShown: false })
    )
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    expect(switchButton(wrapper).attributes('aria-checked')).toBe('false')
  })

  it('searches again when the setting changes in Desktop Settings while the results are open', async () => {
    searchTemplates.mockResolvedValue(answer({ run: [POSTER], partnerSwitch: true }))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    const calls = searchTemplates.mock.calls.length

    settingChanged({ key: 'theme' })
    await flushPromises()
    expect(searchTemplates).toHaveBeenCalledTimes(calls)

    settingChanged({ key: 'templateSearchPartners' })
    await flushPromises()
    expect(searchTemplates).toHaveBeenCalledTimes(calls + 1)
  })

  it('drops a closed answer when the setting changes, and searches again once the results open', async () => {
    searchTemplates.mockResolvedValue(answer({ run: [POSTER], partnerSwitch: true }))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    await wrapper.get('[data-testid="home-template-search"]').trigger('keydown', { key: 'Escape' })
    const calls = searchTemplates.mock.calls.length

    settingChanged({ key: 'templateSearchPartners' })
    await flushPromises()
    expect(searchTemplates).toHaveBeenCalledTimes(calls)

    await input(wrapper).trigger('focus')
    await flushPromises()
    expect(searchTemplates).toHaveBeenCalledTimes(calls + 1)
  })

  it('stops following the setting once Home is gone', async () => {
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    const calls = searchTemplates.mock.calls.length
    wrapper.unmount()
    mounted.splice(mounted.indexOf(wrapper), 1)
    settingChanged({ key: 'templateSearchPartners' })
    await flushPromises()
    expect(searchTemplates).toHaveBeenCalledTimes(calls)
  })

  it('puts focus back in the bar after the switch is turned from the keyboard', async () => {
    searchTemplates.mockResolvedValue(answer({ run: [POSTER], partnerSwitch: true }))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    ;(switchButton(wrapper).element as HTMLElement).focus()
    await switchButton(wrapper).trigger('click')
    await flushPromises()
    expect(document.activeElement).toBe(input(wrapper).element)
  })

  it('puts focus back in the bar when Escape on the switch closes the results', async () => {
    searchTemplates.mockResolvedValue(answer({ run: [POSTER], partnerSwitch: true }))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    ;(switchButton(wrapper).element as HTMLElement).focus()
    await switchButton(wrapper).trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(document.activeElement).toBe(input(wrapper).element)
    expect(wrapper.find('[data-testid="home-template-search-results"]').exists()).toBe(false)
  })

  it('closes on Escape typed in the bar, starting no search there and then, with the bar still focused', async () => {
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    const calls = searchTemplates.mock.calls.length
    ;(input(wrapper).element as HTMLElement).focus()
    await input(wrapper).setValue('a poster for a party')
    await input(wrapper).trigger('keydown', { key: 'Escape' })
    expect(searchTemplates).toHaveBeenCalledTimes(calls)
    expect(wrapper.find('[data-testid="home-template-search-results"]').exists()).toBe(false)
    expect(document.activeElement).toBe(input(wrapper).element)
  })

  it('leaves the switch and the answer as they were when saving the setting fails', async () => {
    searchTemplates.mockResolvedValue(answer({ run: [POSTER], partnerSwitch: true }))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    const calls = searchTemplates.mock.calls.length
    setSetting.mockRejectedValueOnce(new Error('the disk is full'))
    await switchButton(wrapper).trigger('click')
    await flushPromises()
    expect(searchTemplates).toHaveBeenCalledTimes(calls)
    expect(switchButton(wrapper).attributes('aria-checked')).toBe('true')
  })

  it('shows a size from 1 MB, and none below it', async () => {
    const krea = (downloadBytes: number) =>
      candidate('krea_template', {
        needsDownload: true,
        downloadBytes
      })
    for (const [bytes, sized] of [
      [999_999, false],
      [1_000_000, true]
    ] as const) {
      searchTemplates.mockResolvedValue(answer({ run: [POSTER], download: [krea(bytes)] }))
      const wrapper = mountSearch()
      await searchFor(wrapper, `a poster ${bytes}`)
      expect(wrapper.findAll('[role="option"]')[1]!.text().includes('about'), String(bytes)).toBe(
        sized
      )
    }
  })

  it('says only that a download is needed when the remainder is too small to show as a size', async () => {
    const open = candidate('krea_template', {
      needsDownload: true,
      downloadBytes: 300_000
    })
    searchTemplates.mockResolvedValue(answer({ run: [POSTER], download: [open] }))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    const card = wrapper.findAll('[role="option"]')[1]!
    expect(card.get('[data-testid="home-template-search-needs-download"]').text()).toBe(
      'Needs download'
    )
  })
})

describe('verticalNeighbour', () => {
  const box = (left: number, top: number) => ({ left, top, width: 100 })

  it('has no neighbour for a highlight outside the cards', () => {
    expect(verticalNeighbour([box(0, 0)], 3, 1)).toBeNull()
  })

  it('stays put when every card is in one row', () => {
    expect(verticalNeighbour([box(0, 0), box(110, 0), box(220, 0)], 1, 1)).toBe(1)
  })
})

describe('HomeTemplateSearch telemetry', () => {
  const sent: TelemetryActionEventDetail[] = []
  const collect = (event: Event): void => {
    sent.push((event as CustomEvent<TelemetryActionEventDetail>).detail)
  }

  beforeEach(() => {
    sent.length = 0
    window.addEventListener(TELEMETRY_ACTION_EVENT_NAME, collect)
  })

  afterEach(() => {
    window.removeEventListener(TELEMETRY_ACTION_EVENT_NAME, collect)
  })

  function named(name: string): TelemetryActionEventDetail[] {
    return sent.filter((event) => event.actionName === `comfy.desktop.template_search.${name}`)
  }

  it('sends the search and the keyboard pick, and opens with the id of the search it came from', async () => {
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()

    const [searched] = named('searched')
    const searchId = searched!.context!.search_id
    expect(searched!.context).toMatchObject({
      outcome: 'template',
      run_count: 2,
      download_count: 1
    })
    expect(named('picked')[0]!.context).toMatchObject({
      search_id: searchId,
      template_id: 'poster_template',
      input_method: 'keyboard',
      is_best_match: true
    })
    expect(openTemplateInBuild).toHaveBeenCalledWith('build-1', 'poster_template')
    expect(named('open_result')[0]!.context).toMatchObject({
      search_id: searchId,
      result: 'launch'
    })
  })

  it('sends a sign_in pick, and no open result, when a signed-out user picks a partner card', async () => {
    getAuthStatus.mockResolvedValue({ signedIn: false })
    signIn.mockReturnValue(new Promise(() => {}))
    searchTemplates.mockResolvedValue(answer({ run: [POSTER, PARTNER_POSTER] }))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    await wrapper.findAll('[role="option"]')[1]!.trigger('click')
    await flushPromises()

    expect(named('picked')[0]!.context).toMatchObject({
      search_id: named('searched')[0]!.context!.search_id,
      template_id: 'api_poster_template',
      list: 'run',
      list_position: 1,
      position: 1,
      input_method: 'pointer',
      action: 'sign_in'
    })
    expect(named('open_result')).toEqual([])
    expect(opened()).toEqual([])
  })

  it('sends the partner switch state with each search, and a change of the switch', async () => {
    searchTemplates.mockImplementation(async () =>
      answer({
        run: [POSTER],
        partnerSwitch: true,
        partnersShown: settingsStore.get('templateSearchPartners') !== false
      })
    )
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    await wrapper.get('[data-testid="home-template-search-partner-switch"] button').trigger('click')
    await flushPromises()

    const [first, second] = named('searched')
    expect(first!.context).toMatchObject({ partners_shown: true, has_partner_switch: true })
    expect(named('partner_switch_changed')).toEqual([
      expect.objectContaining({
        context: {
          partners_shown: false,
          search_id: first!.context!.search_id,
          session_search_count: 1
        }
      })
    ])
    expect(second!.context).toMatchObject({ partners_shown: false })
  })

  it('sends the switch change even when saving it fails, and no new search', async () => {
    searchTemplates.mockResolvedValue(answer({ run: [POSTER], partnerSwitch: true }))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    setSetting.mockRejectedValueOnce(new Error('the disk is full'))
    await wrapper.get('[data-testid="home-template-search-partner-switch"] button').trigger('click')
    await flushPromises()
    expect(named('partner_switch_changed')).toHaveLength(1)
    expect(named('searched')).toHaveLength(1)
  })

  it('sends no search for a setting change while the results are closed, until they open again', async () => {
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    await wrapper.get('[data-testid="home-template-search"]').trigger('keydown', { key: 'Escape' })
    const searched = named('searched').length

    settingChanged({ key: 'templateSearchPartners' })
    await flushPromises()
    expect(named('searched')).toHaveLength(searched)

    await input(wrapper).trigger('focus')
    await flushPromises()
    expect(named('searched')).toHaveLength(searched + 1)
  })

  it('sends a pointer pick for a clicked card', async () => {
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    await wrapper.findAll('[role="option"]')[2]!.trigger('click')
    await flushPromises()
    expect(named('picked')[0]!.context).toMatchObject({
      template_id: 'mural_template',
      list: 'download',
      input_method: 'pointer',
      action: 'download'
    })
  })

  it('sends a pick made after the results close and open again, against the answer kept', async () => {
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    await wrapper.get('[data-testid="home-template-search"]').trigger('keydown', { key: 'Escape' })
    await input(wrapper).trigger('focus')
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(named('picked')[0]!.context).toMatchObject({
      search_id: named('searched')[0]!.context!.search_id,
      session_search_count: 0
    })
  })

  it('sends a pick made after Down reopens closed results', async () => {
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    await wrapper.get('[data-testid="home-template-search"]').trigger('keydown', { key: 'Escape' })
    await input(wrapper).trigger('keydown', { key: 'ArrowDown' })
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(named('picked')[0]!.context).toMatchObject({ template_id: 'poster_template' })
  })

  it('sends an abandon when Home closes with results showing', async () => {
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    wrapper.unmount()
    expect(named('abandoned').map((event) => event.context!.reason)).toEqual(['left'])
  })

  it('sends an abandon when the request is cleared', async () => {
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    await input(wrapper).setValue('')
    expect(named('abandoned').map((event) => event.context!.reason)).toEqual(['cleared'])
  })

  it('reports an open that never reached a build as failed', async () => {
    openTemplateInBuild.mockRejectedValueOnce(new Error('ipc gone'))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    const noBuild = mountSearch(null)
    await searchFor(noBuild, 'a poster')
    await input(noBuild).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(named('open_result').map((event) => event.context!.result)).toEqual(['failed', 'failed'])
  })

  it('sends an abandon when the results close without a pick', async () => {
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    await wrapper.get('[data-testid="home-template-search"]').trigger('keydown', { key: 'Escape' })
    expect(named('abandoned').map((event) => event.context!.reason)).toEqual(['closed'])
  })

  it('sends the typed request as text with the search, trimmed as it was searched', async () => {
    const wrapper = mountSearch()
    await searchFor(wrapper, '  a flyer for the bake sale on Saturday  ')
    expect(named('searched')[0]!.context).toMatchObject({
      request_text: 'a flyer for the bake sale on Saturday',
      request_chars_count: 37,
      request_words_count: 8,
      request_script: 'latin'
    })
    expect(named('picked')).toEqual([])
  })

  it('times a typed search from the last key press, including the wait before it searches', async () => {
    vi.useFakeTimers()
    const wrapper = mountSearch()
    await input(wrapper).setValue('a post')
    await vi.advanceTimersByTimeAsync(SEARCH_DELAY_MS - 100)
    await input(wrapper).setValue('a poster')
    await vi.advanceTimersByTimeAsync(SEARCH_DELAY_MS)
    expect(named('searched').map((event) => event.context!.input_to_answer_ms)).toEqual([
      SEARCH_DELAY_MS
    ])
  })

  it('keeps the results and the session when focus leaves the bar for something else on Home', async () => {
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    await wrapper
      .get('[data-testid="home-template-search"]')
      .trigger('focusout', { relatedTarget: null })
    expect(panel(wrapper).exists()).toBe(true)
    expect(named('abandoned')).toEqual([])
  })

  it('keeps the session when the window loses focus, and counts it on return', async () => {
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    window.dispatchEvent(new Event('blur'))
    expect(panel(wrapper).exists()).toBe(true)
    window.dispatchEvent(new Event('focus'))
    await searchFor(wrapper, 'a poster for a bake sale')
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(named('abandoned')).toEqual([])
    expect(named('picked')[0]!.context).toMatchObject({ session_search_count: 2 })
  })

  function frozenClock(): (ms: number) => void {
    vi.useFakeTimers({ toFake: ['Date'] })
    return (ms) => vi.setSystemTime(Date.now() + ms)
  }

  it('pauses the time looking at the results while the window is away, and goes on on return', async () => {
    const later = frozenClock()
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    later(5000)
    window.dispatchEvent(new Event('blur'))
    later(60_000)
    window.dispatchEvent(new Event('focus'))
    later(700)
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(named('picked')[0]!.context).toMatchObject({
      results_to_pick_ms: 5700,
      session_ms: 65_700
    })
  })

  it('sends the time spent looking before the window went away when Home closes while away', async () => {
    const later = frozenClock()
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    later(5000)
    window.dispatchEvent(new Event('blur'))
    later(60_000)
    wrapper.unmount()
    expect(named('abandoned')[0]!.context).toMatchObject({
      reason: 'left',
      session_ms: 65_000,
      last_results_shown_ms: 5000,
      last_outcome: 'template'
    })
  })

  it('times an answer that arrived while the window was away from when the window comes back', async () => {
    const later = frozenClock()
    let answerLater!: (response: TemplateSearchResponse) => void
    searchTemplates.mockReturnValueOnce(new Promise((resolve) => (answerLater = resolve)))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    window.dispatchEvent(new Event('blur'))
    answerLater(answer({ run: [POSTER] }))
    await flushPromises()
    later(60_000)
    window.dispatchEvent(new Event('focus'))
    later(400)
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(named('picked')[0]!.context).toMatchObject({ results_to_pick_ms: 400 })
  })

  it('sends a give-up with the answer that arrived while the window was away, seen for no time', async () => {
    const later = frozenClock()
    let answerLater!: (response: TemplateSearchResponse) => void
    searchTemplates.mockReturnValueOnce(new Promise((resolve) => (answerLater = resolve)))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    window.dispatchEvent(new Event('blur'))
    answerLater(answer({ run: [POSTER] }))
    await flushPromises()
    later(2000)
    wrapper.unmount()
    expect(named('abandoned')[0]!.context).toMatchObject({
      reason: 'left',
      last_results_shown_ms: 0,
      last_outcome: 'template'
    })
  })

  it('starts no session when the window comes back after the results closed or a template opened', async () => {
    const closed = mountSearch()
    await searchFor(closed, 'a poster')
    await closed.get('[data-testid="home-template-search"]').trigger('keydown', { key: 'Escape' })
    window.dispatchEvent(new Event('blur'))
    window.dispatchEvent(new Event('focus'))
    closed.unmount()

    const picked = mountSearch()
    await searchFor(picked, 'a poster')
    await input(picked).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    window.dispatchEvent(new Event('blur'))
    window.dispatchEvent(new Event('focus'))
    picked.unmount()
    expect(named('abandoned').map((event) => event.context!.reason)).toEqual(['closed'])
  })

  it('sends nothing while search answers that it is switched off', async () => {
    searchTemplates.mockResolvedValue(unavailable({ kind: 'off' }))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster for my aunt')
    await wrapper.get('[data-testid="home-template-search"]').trigger('keydown', { key: 'Escape' })
    wrapper.unmount()
    expect(sent).toEqual([])
  })

  it('sends an abandon when Home closes after an open was refused', async () => {
    openTemplateInBuild.mockResolvedValueOnce('refused')
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    wrapper.unmount()
    expect(named('abandoned').map((event) => event.context!.reason)).toEqual(['left'])
  })

  it.each([
    ['', false],
    [', even after the window went away and came back', true]
  ])(
    'sends a give-up during a follow-up search as searching, not against the results it replaced%s',
    async (_name, windowAway) => {
      const wrapper = mountSearch()
      await searchFor(wrapper, 'a poster')
      searchTemplates.mockReturnValueOnce(new Promise(() => {}))
      await searchFor(wrapper, 'a poster for a bake sale')
      if (windowAway) {
        window.dispatchEvent(new Event('blur'))
        window.dispatchEvent(new Event('focus'))
      }
      await wrapper
        .get('[data-testid="home-template-search"]')
        .trigger('keydown', { key: 'Escape' })
      expect(named('abandoned')[0]!.context).toMatchObject({
        reason: 'closed',
        last_outcome: 'searching',
        last_results_shown_ms: null,
        session_search_count: 1
      })
    }
  )

  it('resumes the session when a kept notice is shown again', async () => {
    searchTemplates.mockResolvedValue(
      unavailable({ kind: 'downloading', received: 0, total: 1_000_000 })
    )
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    await wrapper.get('[data-testid="home-template-search"]').trigger('keydown', { key: 'Escape' })
    await input(wrapper).trigger('focus')
    await flushPromises()
    await wrapper.get('[data-testid="home-template-search"]').trigger('keydown', { key: 'Escape' })
    expect(named('abandoned').map((event) => event.context!.last_outcome)).toEqual([
      'unavailable',
      'unavailable'
    ])
  })

  it('sends nothing for an answer that arrives after Home closed', async () => {
    let answerLater!: (response: TemplateSearchResponse) => void
    searchTemplates.mockReturnValueOnce(new Promise((resolve) => (answerLater = resolve)))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    wrapper.unmount()
    answerLater(answer({ run: [POSTER] }))
    await flushPromises()
    expect(named('searched')).toEqual([])
    expect(named('abandoned')).toHaveLength(1)
  })

  it('counts a search that answers while the results are closed only when they open again', async () => {
    vi.useFakeTimers()
    const wrapper = mountSearch()
    await input(wrapper).setValue('a poster')
    await wrapper.get('[data-testid="home-template-search"]').trigger('keydown', { key: 'Escape' })
    await vi.advanceTimersByTimeAsync(SEARCH_DELAY_MS)
    expect(named('searched')[0]!.context).toMatchObject({ session_search_count: 0 })
    wrapper.unmount()
    expect(named('abandoned')).toEqual([])
  })

  it('sends the second pick after an open was refused', async () => {
    openTemplateInBuild.mockResolvedValueOnce('refused')
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    await wrapper.findAll('[role="option"]')[1]!.trigger('click')
    await flushPromises()
    expect(named('picked').map((event) => event.context!.template_id)).toEqual([
      'poster_template',
      'banner_template'
    ])
  })

  it('times the pick from when a hidden answer is first shown', async () => {
    vi.useFakeTimers()
    let answerLater!: (response: TemplateSearchResponse) => void
    searchTemplates.mockReturnValueOnce(new Promise((resolve) => (answerLater = resolve)))
    const wrapper = mountSearch()
    await input(wrapper).setValue('a poster')
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await wrapper.get('[data-testid="home-template-search"]').trigger('keydown', { key: 'Escape' })
    answerLater(answer({ run: [POSTER, BANNER], download: [MURAL] }))
    await vi.advanceTimersByTimeAsync(60_000)
    await input(wrapper).trigger('focus')
    await vi.advanceTimersByTimeAsync(700)
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await vi.advanceTimersByTimeAsync(0)
    expect(named('abandoned')[0]!.context).toMatchObject({
      reason: 'closed',
      last_outcome: 'searching'
    })
    expect(named('picked')[0]!.context).toMatchObject({
      results_to_pick_ms: 700,
      session_ms: 700,
      session_search_count: 0
    })
  })
})

describe('HomeTemplateSearch typing', () => {
  it('searches once typing pauses, with the latest text only', async () => {
    vi.useFakeTimers()
    const wrapper = mountSearch()
    await input(wrapper).setValue('a pos')
    await vi.advanceTimersByTimeAsync(SEARCH_DELAY_MS - 1)
    await input(wrapper).setValue('a poster')
    await vi.advanceTimersByTimeAsync(SEARCH_DELAY_MS - 1)
    expect(searchTemplates).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(searchTemplates.mock.calls).toEqual([['a poster', 'build-1']])
  })

  it('shows only the answer to the latest request when an older one arrives late', async () => {
    let finishOld!: (value: TemplateSearchResponse) => void
    searchTemplates.mockReturnValueOnce(new Promise((resolve) => (finishOld = resolve)))
    searchTemplates.mockResolvedValueOnce(answer({ run: [BANNER] }))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    await searchFor(wrapper, 'a banner')
    finishOld(answer({ run: [POSTER] }))
    await flushPromises()
    expect(rowTitles(wrapper)).toEqual(['banner_template title'])
  })

  it('closes the results on Escape and keeps them closed when a typed search answers later', async () => {
    vi.useFakeTimers()
    const wrapper = mountSearch()
    await input(wrapper).trigger('focus')
    await input(wrapper).setValue('a poster')
    await input(wrapper).trigger('input')
    await wrapper.get('[data-testid="home-template-search"]').trigger('keydown', { key: 'Escape' })

    await vi.advanceTimersByTimeAsync(SEARCH_DELAY_MS)
    await flushPromises()

    expect(searchTemplates).toHaveBeenCalledWith('a poster', 'build-1')
    expect(panel(wrapper).exists()).toBe(false)
  })

  it('keeps the results in the page after focus leaves, when a typed search answers later', async () => {
    vi.useFakeTimers()
    const wrapper = mountSearch()
    await input(wrapper).trigger('focus')
    await input(wrapper).setValue('a poster')
    await input(wrapper).trigger('input')
    await wrapper
      .get('[data-testid="home-template-search"]')
      .trigger('focusout', { relatedTarget: null })

    await vi.advanceTimersByTimeAsync(SEARCH_DELAY_MS)
    await flushPromises()

    expect(searchTemplates).toHaveBeenCalledWith('a poster', 'build-1')
    expect(panel(wrapper).exists()).toBe(true)
  })

  it('keeps the results up when focus moves from the bar to another control', async () => {
    const wrapper = mountSearch()
    const other = document.body.insertBefore(
      document.createElement('button'),
      document.body.firstChild
    )
    other.textContent = 'Elsewhere'
    hosts.push(other)
    await userEvent.click(input(wrapper).element)
    await searchFor(wrapper, 'a poster')
    await userEvent.click(other)
    await flushPromises()
    expect(document.activeElement).toBe(other)
    expect(panel(wrapper).exists()).toBe(true)
    expect(wrapper.findAll('[role="option"]').length).toBeGreaterThan(0)
  })
})

describe('HomeTemplateSearch before search is ready', () => {
  it('gets search ready the first time the bar takes focus', async () => {
    const wrapper = mountSearch()
    await input(wrapper).trigger('focus')
    await input(wrapper).trigger('blur')
    await input(wrapper).trigger('focus')
    expect(prepare).toHaveBeenCalledTimes(1)
  })

  it('shows the download running without asking anything, and leaves starting it to Desktop', async () => {
    searchTemplates.mockResolvedValue(unavailable({ kind: 'downloading', received: 0, total: 0 }))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')

    expect(notice(wrapper)).toContain('Downloading search… 0%')
    expect(wrapper.find('[data-testid="home-template-search-download"]').exists()).toBe(false)
    expect(download).not.toHaveBeenCalled()
  })

  it('shows download progress, then answers the waiting search when it is done', async () => {
    searchTemplates.mockResolvedValueOnce(
      unavailable({ kind: 'downloading', received: 0, total: 1000 })
    )
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')

    announce({ kind: 'downloading', received: 420, total: 1000 })
    await flushPromises()
    expect(notice(wrapper)).toContain('42%')

    announce({ kind: 'idle' })
    await flushPromises()
    expect(searchTemplates).toHaveBeenLastCalledWith('a poster', 'build-1')
    expect(rowTitles(wrapper)[0]).toBe('poster_template title')
  })

  it('answers a search made while the build is busy once the build is free', async () => {
    searchTemplates.mockResolvedValueOnce(unavailable({ kind: 'waiting_for_build' }))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    expect(notice(wrapper)).toContain('as soon as your build is free')

    announce({ kind: 'idle' })
    await flushPromises()
    expect(rowTitles(wrapper)[0]).toBe('poster_template title')
  })

  it('offers to try a failed download again', async () => {
    searchTemplates.mockResolvedValue(
      unavailable({ kind: 'unavailable', reason: 'download_failed' })
    )
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    await wrapper.get('[data-testid="home-template-search-download"]').trigger('click')
    expect(download).toHaveBeenCalledTimes(1)
  })

  it.each([
    [{ kind: 'off' } as const, "isn't set up"],
    [{ kind: 'no_local_build' } as const, 'Install a local build to search'],
    [{ kind: 'starting' } as const, 'Getting search ready'],
    [{ kind: 'unavailable', reason: 'runtime_unsupported' } as const, "builds can't run search"],
    [{ kind: 'unavailable', reason: 'update_desktop' } as const, 'Update Desktop'],
    [{ kind: 'unavailable', reason: 'offline' } as const, 'Check your connection']
  ])('says why search cannot answer: %o', async (availability, text) => {
    searchTemplates.mockResolvedValue(unavailable(availability))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    expect(notice(wrapper)).toContain(text)
  })

  it('searches the text in the box, not the text that had to wait, once search is ready', async () => {
    searchTemplates.mockResolvedValueOnce(unavailable({ kind: 'starting' }))
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    await input(wrapper).setValue('a banner')

    announce({ kind: 'ready' })
    await flushPromises()
    expect(searchTemplates).toHaveBeenLastCalledWith('a banner', 'build-1')
  })

  it('stops listening for news about search once it is gone', () => {
    const unsubscribe = vi.fn()
    ;(window.api as unknown as Record<string, unknown>).onTemplateSearchAvailability = () =>
      unsubscribe
    const wrapper = mountSearch()
    expect(unsubscribe).not.toHaveBeenCalled()
    wrapper.unmount()
    mounted.splice(mounted.indexOf(wrapper), 1)
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('ignores news about search when no search is waiting', async () => {
    const wrapper = mountSearch()
    await searchFor(wrapper, 'a poster')
    searchTemplates.mockClear()
    announce({ kind: 'idle' })
    await flushPromises()
    expect(searchTemplates).not.toHaveBeenCalled()
  })
})
