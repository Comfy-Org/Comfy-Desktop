<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'
import Skeleton from '@comfyorg/design-system/skeleton/Skeleton'

const props = defineProps<{
  page: string
}>()

const emit = defineEmits<{
  failed: [url: string]
  back: []
}>()

const slot = useTemplateRef<HTMLElement>('slot')
let observer: ResizeObserver | null = null
const stopListening: Array<() => void> = []

function report(fresh = false): void {
  const el = slot.value
  if (!el) return
  const r = el.getBoundingClientRect()
  window.api.showApps({
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    page: props.page,
    fresh
  })
}

const reportResize = (): void => report()

watch(
  () => props.page,
  () => report(true)
)

onMounted(() => {
  stopListening.push(
    window.api.onAppsLoadFailed(({ url }) => emit('failed', url)),
    window.api.onAppsBack(() => emit('back'))
  )
  observer = new ResizeObserver(reportResize)
  if (slot.value) observer.observe(slot.value)
  window.addEventListener('resize', reportResize)
  report(true)
})

onBeforeUnmount(() => {
  for (const stop of stopListening) stop()
  observer?.disconnect()
  window.removeEventListener('resize', reportResize)
  window.api.hideApps()
})
</script>

<template>
  <div ref="slot" class="panel-apps relative min-h-0 flex-1" data-testid="apps-host">
    <Skeleton class="absolute inset-0 size-full rounded-[14px]" />
  </div>
</template>
