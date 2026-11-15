import { onScopeDispose, ref } from 'vue'

const AUTO_START_SETTING = 'autoLaunchOnStartup'
const AUTO_START_NONE = 'none'

export function useAutoStartBuild() {
  const autoStartValue = ref<unknown>(undefined)
  let revision = 0

  async function read(): Promise<void> {
    const seen = ++revision
    try {
      const value = await window.api.getSetting(AUTO_START_SETTING)
      if (seen === revision) autoStartValue.value = value
    } catch {}
  }

  const unsubscribe = window.api.onSettingsChanged(({ key }) => {
    if (key === AUTO_START_SETTING) void read()
  })
  onScopeDispose(unsubscribe)
  void read()

  function startsOnOpen(buildId: string): boolean {
    return autoStartValue.value === buildId
  }

  async function setStartsOnOpen(buildId: string, on: boolean): Promise<void> {
    if (on === startsOnOpen(buildId)) return
    const next = on ? buildId : AUTO_START_NONE
    revision++
    autoStartValue.value = next
    try {
      await window.api.setSetting(AUTO_START_SETTING, next)
    } catch {
      await read()
    }
  }

  return { startsOnOpen, setStartsOnOpen }
}
