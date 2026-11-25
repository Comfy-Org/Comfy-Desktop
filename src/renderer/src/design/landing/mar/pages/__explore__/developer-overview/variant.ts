import { ref } from 'vue'

export const VARIANTS = [
  { value: 'a', label: 'A · Per build only' },
  { value: 'b', label: 'B · Deployments tab in Builds' },
  { value: 'c', label: 'C · Usage is the overview' },
  { value: 'd', label: 'D · Deploy page' }
] as const
export type Variant = (typeof VARIANTS)[number]['value']

const read = (): Variant | '' => {
  const v = new URLSearchParams(location.search).get('variant')
  return VARIANTS.some((o) => o.value === v) ? (v as Variant) : 'b'
}
export const devVariant = ref<Variant | ''>(read())
export function pick(v: Variant): void {
  const url = new URL(location.href)
  url.searchParams.set('variant', v)
  history.replaceState(history.state, '', url)
  devVariant.value = v
}
