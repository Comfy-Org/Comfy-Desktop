import { inject, provide } from 'vue'
import type { InjectionKey } from 'vue'

/** The class that puts a subtree in the Void palette (assets/palette-void.css). */
export const PALETTE_VOID_CLASS = 'palette-void'

/**
 * A `<Teleport to="body">` leaves its opener's DOM subtree, so a menu, listbox
 * or tooltip opened from a Void screen would not inherit the class. Vue's
 * component tree still links them: the screen provides the class and the
 * teleported root binds it.
 */
const PALETTE_SCOPE: InjectionKey<string> = Symbol('palette-scope')

/** Put this component's subtree in the Void palette. Returns the class for its root. */
export function providePaletteScope(): string {
  provide(PALETTE_SCOPE, PALETTE_VOID_CLASS)
  return PALETTE_VOID_CLASS
}

/** The palette class of the screen that opened this component, if it has one. */
export function usePaletteScope(): string | undefined {
  return inject(PALETTE_SCOPE, undefined)
}
