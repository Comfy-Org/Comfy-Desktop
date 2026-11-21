export type ConfirmTone = 'primary' | 'danger'

export const DESTRUCTIVE_MENU_ITEM_CLASS =
  'text-destructive focus:text-destructive data-highlighted:bg-destructive/12 data-highlighted:text-destructive'

export function confirmToneForActionStyle(style: string | undefined): ConfirmTone {
  return style === 'danger' ? 'danger' : 'primary'
}
