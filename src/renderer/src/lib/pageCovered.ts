import type { InjectionKey, Ref } from 'vue'

/** True while a title-bar modal covers the page; page surfaces go inert beneath it. */
export const PAGE_COVERED: InjectionKey<Readonly<Ref<boolean>>> = Symbol('pageCovered')
