<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'
import { useDialogs } from '../composables/useDialogs'
import { useModal } from '../composables/useModal'

const props = defineProps<{ obscured?: boolean }>()

const emit = defineEmits<{
  failed: [url: string]
  'app-open': [open: boolean]
}>()

const slot = useTemplateRef<HTMLElement>('slot')
let observer: ResizeObserver | null = null
let stopListening: (() => void) | null = null
let stopAppOpen: (() => void) | null = null
let freshPending = true

const { state: modal } = useModal()
const { state: dialog } = useDialogs()
const hidden = computed(() => props.obscured === true || modal.visible || dialog.open)

function report(): void {
  const el = slot.value
  if (!el || hidden.value) return
  const r = el.getBoundingClientRect()
  window.api.showApps({ x: r.x, y: r.y, width: r.width, height: r.height, fresh: freshPending })
  freshPending = false
}

watch(hidden, (isHidden) => (isHidden ? window.api.hideApps() : report()))

const reportResize = (): void => report()

onMounted(() => {
  stopListening = window.api.onAppsLoadFailed(({ url }) => emit('failed', url))
  stopAppOpen = window.api.onAppsAppOpen(({ open }) => emit('app-open', open))
  observer = new ResizeObserver(reportResize)
  if (slot.value) observer.observe(slot.value)
  window.addEventListener('resize', reportResize)
  report()
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
  <div ref="slot" class="min-h-0 flex-1" data-testid="apps-host" />
</template>
