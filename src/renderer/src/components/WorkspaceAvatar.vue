<script setup lang="ts">
import { computed } from 'vue'
import { workspaceAvatarStyle } from '@comfyorg/design-system/workspaceAvatar'

const {
  workspaceName,
  subscriptionTier,
  size = 'md'
} = defineProps<{
  workspaceName: string
  subscriptionTier: string | null | undefined
  size?: 'sm' | 'md'
}>()

const graphemes = new Intl.Segmenter()

function firstGrapheme(text: string): string | undefined {
  return graphemes.segment(text.trim())[Symbol.iterator]().next().value?.segment
}

function initialOf(name: string): string {
  const first = firstGrapheme(name)
  if (!first) return '?'
  const upper = first.toUpperCase()
  return firstGrapheme(upper) === upper ? upper : first
}

const initial = computed(() => initialOf(workspaceName))
const avatarStyle = computed(() => workspaceAvatarStyle(workspaceName, subscriptionTier))
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center justify-center bg-card font-semibold text-foreground"
    :class="size === 'sm' ? 'size-6 rounded-sm text-xs' : 'size-8 rounded-md text-sm'"
    :style="avatarStyle"
    data-testid="workspace-avatar"
    aria-hidden="true"
    >{{ initial }}</span
  >
</template>
