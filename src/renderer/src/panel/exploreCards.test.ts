import { describe, expect, it } from 'vitest'
import { exploreCards, filterGroups, type ExploreCard, type ExploreView } from './exploreCards'

function card(title: string, over: Partial<ExploreCard> = {}): ExploreCard {
  return { title, description: '', category: null, ...over }
}

const VIEW: ExploreView = { query: '', picks: {}, sort: 'recommended' }

describe('Explore cards', () => {
  it('puts ranked cards first by rank and keeps the catalog order for ties and unranked ones', () => {
    const cards = [
      card('c'),
      card('b', { rank: 2 }),
      card('a', { rank: 1 }),
      card('d', { rank: 2 }),
      card('e')
    ]

    expect(exploreCards(cards, VIEW).map((c) => c.title)).toEqual(['a', 'b', 'd', 'c', 'e'])
  })

  it('offers a group only when the cards carry two or more of its values', () => {
    const cards = [
      card('one', { category: 'image', models: ['Flux'] }),
      card('two', { category: 'image', models: ['Wan'] })
    ]

    expect(filterGroups(cards, VIEW).map((group) => group.key)).toEqual(['model'])
  })

  it('keeps a picked group in the menu even when the data no longer splits it', () => {
    const cards = [card('one', { category: 'image' })]
    const view: ExploreView = { ...VIEW, picks: { type: ['image'] } }

    expect(filterGroups(cards, view)).toEqual([
      { key: 'type', options: [{ value: 'image', label: 'image', count: 1 }] }
    ])
  })

  it('lists models with the most cards first, then by name', () => {
    const cards = [
      card('one', { models: ['Wan'] }),
      card('two', { models: ['Flux', 'Wan'] }),
      card('three', { models: ['Chroma'] })
    ]

    const models = filterGroups(cards, VIEW).find((group) => group.key === 'model')!
    expect(models.options.map((option) => option.value)).toEqual(['Wan', 'Chroma', 'Flux'])
  })
})
