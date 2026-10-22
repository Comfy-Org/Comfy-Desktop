<script setup lang="ts">
import { ArrowDownToLine } from 'lucide-vue-next'
import Badge from '../ui/Badge.vue'
import StatusDot from '../ui/StatusDot.vue'
import { proto } from '../useProto'
import type { ProtoInstance } from '../mock'

defineProps<{ inst: ProtoInstance }>()
</script>

<template>
  <Badge v-if="inst.kind === 'cloud' && !inst.deployment && !proto.signedIn" variant="outline"
    >Free credits</Badge
  >
  <Badge v-else-if="inst.state === 'running'"><StatusDot status="running" />Running</Badge>
  <Badge v-else-if="inst.state === 'launching'">Starting…</Badge>
  <Badge v-else-if="inst.state === 'update'"><ArrowDownToLine :size="11" />Update</Badge>
</template>
