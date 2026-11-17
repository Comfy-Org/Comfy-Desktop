import type { InjectionKey } from 'vue'

export const TOOLTIP_GATE: InjectionKey<() => boolean> = Symbol('tooltipGate')
