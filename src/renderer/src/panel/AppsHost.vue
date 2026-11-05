<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef } from 'vue'

// Main lays the hosted Apps page over this element; it renders nothing itself.
const slot = useTemplateRef<HTMLElement>('slot')
let observer: ResizeObserver | null = null

function report(): void {
  const el = slot.value
  if (!el) return
  const r = el.getBoundingClientRect()
  window.api.showApps({ x: r.x, y: r.y, width: r.width, height: r.height })
}

onMounted(() => {
  observer = new ResizeObserver(report)
  if (slot.value) observer.observe(slot.value)
  window.addEventListener('resize', report)
  report()
})

onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('resize', report)
  window.api.hideApps()
})
</script>

<template>
  <div ref="slot" class="panel-apps min-h-0 flex-1" data-testid="apps-host" />
</template>
