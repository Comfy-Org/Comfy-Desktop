import { reactive } from 'vue'
import { homeLayout } from './homeLayout'

export type HomeIdeaSwitch = 'off' | 'on'

export type HomeIdeaId = 'compactRecents' | 'smallGreeting'

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
