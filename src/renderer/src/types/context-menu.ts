import type { Component } from 'vue'

export interface ContextMenuItem {
  id: string
  label: string
  hint?: string
  hintUrl?: string
  hintLinkLabel?: string
  icon?: Component
  disabled?: boolean
  title?: string
  separator?: boolean
  style?: 'default' | 'danger'
}
