export interface ContextMenuItem {
  id: string
  label: string
  hint?: string
  hintUrl?: string
  hintLinkLabel?: string
  icon?: string
  disabled?: boolean
  title?: string
  separator?: boolean
  style?: 'default' | 'danger'
}
