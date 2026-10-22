<script setup lang="ts">
import { Globe, Lock, Users } from 'lucide-vue-next'
import MediaCard from '../ui/MediaCard.vue'
import { toast } from '../useProto'
import { thumb, type App } from '../mock'

/** An app as a card: thumbnail, name, who it's shared with. */
const { app } = defineProps<{ app: App }>()
const SHARED = {
  everyone: { icon: Globe, label: 'Everyone' },
  team: { icon: Users, label: 'Workspace' },
  private: { icon: Lock, label: 'Only you' }
}
</script>

<template>
  <MediaCard
    :src="thumb(app.thumbId)"
    ratio="16/10"
    @click="toast(`Open ${app.name}`)"
    @keydown.enter="toast(`Open ${app.name}`)"
  >
    <p class="truncate text-ui font-semibold">{{ app.name }}</p>
    <p class="mt-1 flex items-center gap-1.5 text-ui text-subtle-foreground">
      <component :is="SHARED[app.shared].icon" :size="12" />{{ SHARED[app.shared].label }} ·
      {{ app.owner }}
    </p>
  </MediaCard>
</template>
