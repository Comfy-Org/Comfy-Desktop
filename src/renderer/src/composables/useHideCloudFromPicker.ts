import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

export function useHideCloudFromPicker(): Ref<boolean> {
  const hideCloudFromPicker = ref(false)
  let unsubSettingsChanged: (() => void) | null = null

  const refetchHideCloud = async (): Promise<void> => {
    try {
      const value = await window.api.getSetting('hideCloudFromPicker')
      hideCloudFromPicker.value = value === true
    } catch {
      hideCloudFromPicker.value = false
    }
  }

  onMounted(() => {
    void refetchHideCloud()
    unsubSettingsChanged = window.api.onSettingsChanged((data) => {
      if (data?.key === 'hideCloudFromPicker') void refetchHideCloud()
    })
  })
  onBeforeUnmount(() => {
    if (unsubSettingsChanged) unsubSettingsChanged()
  })

  return hideCloudFromPicker
}
