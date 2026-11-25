import { inject, provide, ref, type InjectionKey, type Ref } from 'vue'

/**
 * How a page frame shows its page (DsApp.vue's template):
 *   hero      one large example: the `hero` section's `hero` cell alone
 *   states    every section, each row of cells collapsed to the key ones
 *   specs     the hero small, then the page's tokens (kit/SpecsTable.vue)
 *   dodont    the page's Do / Don't pairs (pages/DoDont.vue)
 *   overview, details   foundation pages: their summary, then the rest
 */
export type DsMode = 'hero' | 'states' | 'specs' | 'dodont' | 'overview' | 'details'

export interface ModeContext {
  mode: DsMode
  /** Which section and which cell in it make the hero. */
  hero: [section: number, cell: number]
  sections: number
  /** The hero's row has rendered (a section may hold several rows). */
  heroTaken?: boolean
  /** How many cells the hero's row has (one means the hero is everything). */
  heroCount?: number
  /** States: how many sections the page has, and whether all show. */
  total: Ref<number>
  showAll: Ref<boolean>
}
const KEY: InjectionKey<ModeContext> = Symbol('ds-mode')
const SECTION: InjectionKey<number> = Symbol('ds-section')

export function provideMode(ctx: ModeContext): void {
  provide(KEY, ctx)
}
export const useMode = (): ModeContext =>
  inject(KEY, { mode: 'states', hero: [0, 0], sections: 0, total: ref(0), showAll: ref(true) })

/** Each Section takes the next index, and hands it to its Cells. */
export function takeSection(): number {
  const ctx = useMode()
  const i = ctx.sections++
  ctx.total.value = ctx.sections
  provide(SECTION, i)
  return i
}
export const useSection = (): number => inject(SECTION, -1)

/** A titled section of a frame, for the page's “On this page” links:
 *  `top` is its offset inside `frame`. */
export interface FrameSection {
  title: string
  top: number
  frame: HTMLElement
}

/** How many cells a collapsed row shows, and sections States shows. */
export const KEY_STATES = 6
export const KEY_SECTIONS = 2
