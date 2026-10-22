import { ref, shallowRef } from 'vue'
import type { LlmScope } from '../llm'

/**
 * Actions scoped to what the inspector shows (a component or a token),
 * shown in the inspector footer. Global actions (Publish, Revert all) live
 * in the top bar.
 */
export interface ScopedActions {
  /** What they act on, e.g. "Button" or "muted-foreground". */
  label: string
  /** Draft changes that belong to it. */
  changes: number
  scope: LlmScope
  /** Undo only its changes; absent when it has nothing of its own to undo. */
  revert?: () => void
}
export const scopedActions = shallowRef<ScopedActions | null>(null)

/** The token inspector's tab; kept here so it sticks between tokens. */
export const tokenTab = ref<'edit' | 'merge' | 'info'>('edit')
