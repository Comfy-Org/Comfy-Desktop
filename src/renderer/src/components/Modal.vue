<script setup lang="ts">
import { computed } from 'vue'
import DesktopDialogSurface from './ui/DesktopDialogSurface.vue'

type Opacity = 'dim' | 'heavy-dim' | 'opaque'

const props = withDefaults(
  defineProps<{
    binding?: boolean
    opacity?: Opacity
    width?: 'regular' | 'wide'
    contentClass?: string
    inline?: boolean
    ariaLabel?: string
    ariaLabelledby?: string
  }>(),
  {
    binding: false,
    opacity: undefined,
    width: 'wide',
    contentClass: '',
    inline: false,
    ariaLabel: undefined,
    ariaLabelledby: undefined
  }
)

const resolvedOpacity = computed<Opacity>(() => props.opacity ?? (props.binding ? 'opaque' : 'dim'))

const emit = defineEmits<{
  close: []
}>()
</script>

<template>
  <div
    v-if="inline"
    data-modal-content="inline"
    class="mx-7.5 flex h-full max-w-none w-full flex-col overflow-hidden rounded-none border-none bg-bg"
    :class="contentClass"
  >
    <slot />
  </div>
  <DesktopDialogSurface
    v-else
    :open="true"
    :aria-label="ariaLabel"
    :aria-labelledby="ariaLabelledby"
    :dismiss-on-escape="!binding"
    :dismiss-on-outside="!binding"
    :overlay-class="[
      'view-modal active fixed inset-0 z-50 flex items-center justify-center',
      resolvedOpacity === 'heavy-dim'
        ? 'view-modal--heavy-dim bg-(--overlay-bg-heavy)'
        : resolvedOpacity === 'opaque'
          ? 'view-modal--opaque bg-(--overlay-bg-opaque)'
          : 'bg-(--overlay-bg)'
    ]"
    :content-class="[
      'mx-7.5 flex h-[calc(100vh-60px)] w-full flex-col overflow-hidden rounded-xl border border-solid border-border bg-bg',
      width === 'regular' ? 'max-w-150' : 'max-w-225',
      contentClass
    ]"
    :data-modal-content="width"
    @close="emit('close')"
  >
    <slot />
  </DesktopDialogSurface>
</template>
