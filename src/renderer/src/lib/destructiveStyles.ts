export type ConfirmTone = 'primary' | 'danger'

export function confirmToneForActionStyle(style: string | undefined): ConfirmTone {
  return style === 'danger' ? 'danger' : 'primary'
}
