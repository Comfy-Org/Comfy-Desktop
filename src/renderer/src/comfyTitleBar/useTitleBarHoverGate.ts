import { onMounted, onUnmounted, ref, type Ref } from 'vue'

interface UseTitleBarHoverGateOpts {
  hideTip: () => void
  handleTooltipPointer: (event: PointerEvent) => void
}

interface TitleBarHoverGateApi {
  isHoverActive: Ref<boolean>
}

export function useTitleBarHoverGate(opts: UseTitleBarHoverGateOpts): TitleBarHoverGateApi {
  const isHoverActive = ref(true)

  const handleWindowBlur = (): void => {
    isHoverActive.value = false
    opts.hideTip()
  }

  const handlePointerMove = (event: PointerEvent): void => {
    if (!isHoverActive.value) isHoverActive.value = true
    opts.handleTooltipPointer(event)
  }

  const handlePointerLeave = (): void => {
    isHoverActive.value = false
    opts.hideTip()
  }

  onMounted(() => {
    window.addEventListener('blur', handleWindowBlur)
    window.addEventListener('pointermove', handlePointerMove)
    document.documentElement.addEventListener('pointerleave', handlePointerLeave)
    isHoverActive.value = false
  })

  onUnmounted(() => {
    window.removeEventListener('blur', handleWindowBlur)
    window.removeEventListener('pointermove', handlePointerMove)
    document.documentElement.removeEventListener('pointerleave', handlePointerLeave)
  })

  return { isHoverActive }
}
