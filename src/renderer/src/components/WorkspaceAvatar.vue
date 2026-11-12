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

const initial = computed(() => [...workspaceName][0]?.toUpperCase() ?? '?')
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
