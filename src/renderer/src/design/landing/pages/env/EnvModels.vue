<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowDownToLine, Boxes, Puzzle } from 'lucide-vue-next'
import Badge from '../../ui/Badge.vue'
import Card from '../../ui/Card.vue'
import EmptyState from '../../ui/EmptyState.vue'
import SearchInput from '../../ui/SearchInput.vue'
import SegmentedControl from '../../ui/SegmentedControl.vue'
import { envKind } from '../../parts/env/env'
import { ENV_MODELS, ENV_NODES, type ProtoInstance } from '../../mock'

/** What's installed - what makes this environment different, and what a
 *  version snapshots. */
const { env } = defineProps<{ env: ProtoInstance }>()
const tab = ref<'models' | 'nodes'>('models')
const q = ref('')
const models = computed(() =>
  ENV_MODELS.slice(0, Math.max(3, Math.min(ENV_MODELS.length, env.models ?? 7))).filter((m) =>
    m.name.includes(q.value.toLowerCase())
  )
)
const nodes = computed(() =>
  ENV_NODES.filter((n) => n.name.toLowerCase().includes(q.value.toLowerCase()))
)
</script>

<template>
  <EmptyState
    v-if="envKind(env) === 'managed'"
    :icon="Boxes"
    title="Everything is pre-installed"
    description="Comfy Cloud is managed: every supported model and popular node pack is ready, always on the latest version."
    class="mt-4"
  />
  <div v-else class="mt-4">
    <div class="mb-3 flex items-center justify-between gap-3">
      <SegmentedControl
        v-model="tab"
        :options="[
          { value: 'models', label: 'Models', icon: Boxes, count: env.models },
          { value: 'nodes', label: 'Custom nodes', icon: Puzzle, count: env.nodes }
        ]"
      />
      <SearchInput
        v-model="q"
        :placeholder="tab === 'models' ? 'Search models' : 'Search node packs'"
        class="w-52"
      />
    </div>
    <Card class="p-1.5">
      <template v-if="tab === 'models'">
        <div
          v-for="m in models"
          :key="m.name"
          class="grid min-h-11 grid-cols-[minmax(0,1fr)_120px_90px] items-center gap-4 rounded-control px-3 hover:bg-secondary-background"
        >
          <span class="truncate font-mono text-ui">{{ m.name }}</span>
          <span class="text-ui text-muted-foreground capitalize">{{ m.kind }}</span>
          <span class="text-right text-ui text-subtle-foreground tabular-nums">{{ m.size }}</span>
        </div>
      </template>
      <template v-else>
        <div
          v-for="n in nodes"
          :key="n.name"
          class="flex min-h-11 items-center gap-4 rounded-control px-3 hover:bg-secondary-background"
        >
          <span class="flex-1 truncate text-ui">{{ n.name }}</span>
          <span class="text-ui text-subtle-foreground tabular-nums">v{{ n.version }}</span>
          <Badge v-if="!n.updated"><ArrowDownToLine :size="11" />Update</Badge>
          <span v-else class="w-16" />
        </div>
      </template>
    </Card>
  </div>
</template>
