import { defineComponent, provide, type InjectionKey, type Ref } from 'vue'

/** True while a title-bar modal covers the page; page surfaces go inert beneath it. */
export const PAGE_COVERED: InjectionKey<Readonly<Ref<boolean>>> = Symbol('pageCovered')

/** Set under `PageScope`: a BaseModal teleported out of the page still belongs to it. */
export const IN_PAGE: InjectionKey<boolean> = Symbol('inPage')

export const PageScope = defineComponent({
  name: 'PageScope',
  setup(_, { slots }) {
    provide(IN_PAGE, true)
    return () => slots.default?.()
  }
})
