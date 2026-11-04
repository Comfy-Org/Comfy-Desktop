<script setup lang="ts">
import { computed } from 'vue'
import { FolderOpen } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import { toast } from '../../useProto'
import type { ProtoInstance } from '../../mock'
import { factsOf, stateOf } from './buildFacts'
import './buildTabs.css'

/**
 * A build's facts: production's About tab (Instance Info) in the New UI,
 * label over value. The location reveals in Finder.
 */
const { env } = defineProps<{ env: ProtoInstance }>()
const facts = factsOf(env)
const state = stateOf(env)

const FACTS = computed(() => [
  { label: 'Install Method', value: facts.method },
  { label: 'Current Version', value: state.version },
  { label: 'Hardware', value: facts.hardware },
  { label: 'Python', value: facts.python },
  { label: 'PyTorch', value: facts.torch },
  { label: 'Disk Usage', value: env.kind === 'local' ? `${facts.disk} · 412 GB free` : '—' },
  ...(env.kind === 'local' ? [{ label: 'Location', value: facts.path, reveal: true }] : [])
])
</script>

<template>
  <Card class="mar-bt-facts">
    <div v-for="f in FACTS" :key="f.label" class="mar-bt-fact" :class="'reveal' in f && 'is-wide'">
      <span class="mar-bt-fact-label">{{ f.label }}</span>
      <span class="mar-bt-fact-value">
        <span class="truncate" :class="'reveal' in f && 'font-mono'">{{ f.value }}</span>
        <Button
          v-if="'reveal' in f"
          variant="ghost"
          size="icon-xs"
          aria-label="Show in Finder"
          title="Show in Finder"
          @click="toast(`Revealed ${env.name}`)"
          ><FolderOpen :size="13"
        /></Button>
      </span>
    </div>
  </Card>
</template>
