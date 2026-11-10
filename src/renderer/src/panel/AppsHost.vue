<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef } from 'vue'

const props = defineProps<{
  url: string
}>()

const emit = defineEmits<{
  failed: [url: string]
  'app-open': [open: boolean]
}>()

const slot = useTemplateRef<HTMLElement>('slot')
let observer: ResizeObserver | null = null
let stopListening: (() => void) | null = null
let stopAppOpen: (() => void) | null = null

function report(fresh = false): void {
  const el = slot.value
  if (!el) return
  const r = el.getBoundingClientRect()
  window.api.showApps({ x: r.x, y: r.y, width: r.width, height: r.height, fresh, url: props.url })
}

const reportResize = (): void => report()

onMounted(() => {
  stopListening = window.api.onAppsLoadFailed(({ url }) => emit('failed', url))
  stopAppOpen = window.api.onAppsAppOpen(({ open }) => emit('app-open', open))
  observer = new ResizeObserver(reportResize)
  if (slot.value) observer.observe(slot.value)
  window.addEventListener('resize', reportResize)
  report(true)
})

onBeforeUnmount(() => {
  stopListening?.()
  stopAppOpen?.()
  observer?.disconnect()
  window.removeEventListener('resize', reportResize)
  window.api.hideApps()
})
</script>

<template>
  <div ref="slot" class="panel-apps min-h-0 flex-1" data-testid="apps-host" />
</template>
