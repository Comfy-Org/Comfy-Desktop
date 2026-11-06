import type { Component } from 'vue'

/** One line of an item's menu (Mar's pages). A `sub` opens a second
 *  panel (Move to project); `danger` is the red one, always last. */
export interface MenuAction {
  label: string
  icon?: Component
  run?: () => void
  danger?: boolean
  hint?: string
  checked?: boolean
  disabled?: boolean
  /** Why it's disabled, on hover. */
  title?: string
  sub?: MenuAction[]
}
/** A quiet line of words, not an action (why some lines are greyed). */
export interface MenuNote {
  note: string
}
export type MenuLine = MenuAction | MenuNote | 'sep'
