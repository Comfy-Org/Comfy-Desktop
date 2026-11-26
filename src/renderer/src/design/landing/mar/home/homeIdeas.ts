import { reactive } from 'vue'
import { homeLayout } from './homeLayout'

export type HomeIdeaSwitch = 'off' | 'on'

export type HomeIdeaId = 'thumbs' | 'headers' | 'cleanCards' | 'compactRecents' | 'smallGreeting'

export interface HomeIdea {
  id: HomeIdeaId
  key: string
  label: string
  note: string
  store: { id: HomeIdeaSwitch }
  def: HomeIdeaSwitch
}

const idea = (
  id: HomeIdeaId,
  key: string,
  label: string,
  note: string,
  def: HomeIdeaSwitch = 'off'
): HomeIdea => ({
  id,
  key,
  label,
  note,
  def,
  store: reactive({ id: def })
})

export const HOME_IDEAS: HomeIdea[] = [
  idea(
    'thumbs',
    'hi1',
    'Real thumbnails in Recently used',
    'Each recent workflow shows its last output instead of the graph illustration.'
  ),
  idea(
    'headers',
    'hi2',
    'Same headers everywhere',
    'APPS › like RECENTLY USED ›, apps only, no tabs or See all link.'
  ),
  idea(
    'cleanCards',
    'hi3',
    'Cleaner app cards',
    'Only the name at rest; the one line fades in on hover or focus.'
  ),
  idea(
    'compactRecents',
    'hi4',
    'Compact Recently used',
    "Create's Recents rows, five at most, instead of the tall cards."
  ),
  idea(
    'smallGreeting',
    'hi5',
    'Smaller greeting',
    'One line at the page title size, left-aligned with the content.'
  )
]

export const HOME_IDEA_SWITCHES = [{ value: 'off' }, { value: 'on' }] as const

export const homeIdea = (id: HomeIdeaId): HomeIdea => HOME_IDEAS.find((x) => x.id === id)!

export const homeIdeaOn = (id: HomeIdeaId): boolean =>
  homeLayout.id === 'recents' && homeIdea(id).store.id === 'on'
