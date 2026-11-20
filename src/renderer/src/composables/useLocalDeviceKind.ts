import { inject, onMounted, provide, ref, type InjectionKey, type Ref } from 'vue'

export type LocalDeviceKind = 'laptop' | 'pc-laptop' | 'monitor'

const localDeviceKindKey: InjectionKey<Ref<LocalDeviceKind>> = Symbol('localDeviceKind')
const portableChassisTypes = new Set([
  'Portable',
  'Laptop',
  'Notebook',
  'Hand Held',
  'Sub Notebook',
  'Tablet',
  'Convertible',
  'Detachable'
])

export function deviceKindForChassis(
  platform: string,
  chassisType: string | null
): LocalDeviceKind {
  if (!chassisType || !portableChassisTypes.has(chassisType)) return 'monitor'
  return platform === 'darwin' ? 'laptop' : 'pc-laptop'
}

export function provideLocalDeviceKind(): void {
  const kind = ref<LocalDeviceKind>('monitor')
  provide(localDeviceKindKey, kind)
  onMounted(async () => {
    try {
      const chassisType = await window.api.getChassisType()
      kind.value = deviceKindForChassis(window.api.platform, chassisType)
    } catch {}
  })
}

export function useLocalDeviceKind(): Ref<LocalDeviceKind> {
  return inject(localDeviceKindKey, () => ref<LocalDeviceKind>('monitor'), true)
}
