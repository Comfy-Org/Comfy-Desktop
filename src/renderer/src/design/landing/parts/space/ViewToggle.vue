<script setup lang="ts">
import { computed } from 'vue'
import { Eye, Shield } from 'lucide-vue-next'
import SegmentedControl from '../../ui/SegmentedControl.vue'
import { previewSpace } from '../../spaces'
import { proto } from '../../useProto'

/** LinkedIn-pages style switch for studio admins: manage the space, or
 *  see it exactly as members do. */
const { spaceId } = defineProps<{ spaceId: string }>()
const view = computed({
  get: () => (proto.viewAs === 'client' ? 'client' : 'admin'),
  set: (v: 'admin' | 'client') => {
    if (v === 'client') previewSpace(spaceId)
    else {
      proto.viewAs = 'studio'
      proto.previewing = false
      proto.mode = 'create'
      proto.page = `space:${spaceId}`
    }
  }
})
</script>

<template>
  <SegmentedControl
    v-model="view"
    variant="contained"
    :options="[
      { value: 'admin', label: 'Admin view', icon: Shield },
      { value: 'client', label: 'Member view', icon: Eye }
    ]"
  />
</template>
