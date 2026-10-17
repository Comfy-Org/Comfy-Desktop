import { inject, provide } from 'vue'
import type { InjectionKey } from 'vue'

/**
 * The Void palette for legacy components (assets/palette-void.css) applies
 * under the class `palette-void`. A `<Teleport to="body">` leaves the DOM
 * tree, so a teleported menu, listbox or tooltip never inherits the class
 * from the screen that opened it. Vue's component tree is unaffected, so the
 * scope travels by provide/inject instead: the in-scope root provides it, the
 * teleported element binds it on its teleported root.
 */
const PALETTE_SCOPE: InjectionKey<string> = Symbol('palette-scope')

const PALETTE_CLASS = 'palette-void'

/** Mark this component's subtree as in scope. Returns the class for its root. */
export function providePaletteScope(): string {
  provide(PALETTE_SCOPE, PALETTE_CLASS)
  return PALETTE_CLASS
}

/** The palette class when opened inside a scope, otherwise none. */
export function usePaletteScope(): string | undefined {
  return inject(PALETTE_SCOPE, undefined)
}
