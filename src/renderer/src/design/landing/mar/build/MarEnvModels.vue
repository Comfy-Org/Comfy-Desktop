<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowDownToLine, ArrowRight, Download, TriangleAlert } from 'lucide-vue-next'
import Badge from '../../ui/Badge.vue'
import Button from '../../ui/Button.vue'
import { ENV_NODES, type ProtoInstance } from '../../mock'
import { go, toast } from '../../useProto'
import { can } from '../../milestones'
import MarSeg from '../pages/MarSeg.vue'
import MarSearchField from '../pages/MarSearchField.vue'
import ModelStatus from './ModelStatus.vue'
import ModelTile from './ModelTile.vue'
import {
  fmtSize,
  missingFor,
  modelsApi,
  modelsState,
  TYPE_LABEL,
  WORKFLOW_NEEDS,
  type Model
} from './models'

/** What a build on this computer loads: its models come from the shared
 *  models library (Build > Models), plus what its workflows still miss. */
const { env } = defineProps<{ env: ProtoInstance }>()
const tab = ref<'models' | 'nodes'>('models')
const q = ref('')
const has = (x: Model): boolean =>
  `${x.name} ${x.file}`.toLowerCase().includes(q.value.toLowerCase())
const models = computed(() =>
  modelsState.models.filter((x) => x.installed && x.usedBy.includes(env.id) && has(x))
)
const size = computed(() => models.value.reduce((n, x) => n + x.sizeGb, 0))
const needs = computed(() =>
  WORKFLOW_NEEDS.filter((w) => w.build === env.id)
    .map((w) => ({ w, missing: missingFor(w) }))
    .filter((x) => x.missing.length)
)
const nodes = computed(() =>
  ENV_NODES.filter((n) => n.name.toLowerCase().includes(q.value.toLowerCase()))
)

function downloadAll(ids: string[]): void {
  let n = 0
  for (const id of ids) if (modelsApi.download(id, env.id)) n++
  toast(n < ids.length ? 'Not enough space for all of them' : `Downloading ${n} models`)
}
</script>

<template>
  <div class="mt-4">
    <div class="mb-3 flex items-center justify-between gap-3">
      <MarSeg
        v-model="tab"
        label="In this build's models"
        :options="[
          { value: 'models', label: 'Models', count: models.length },
          { value: 'nodes', label: 'Custom nodes', count: env.nodes }
        ]"
      />
      <div class="flex items-center gap-2">
        <MarSearchField
          v-model="q"
          :placeholder="tab === 'models' ? 'Search models' : 'Search node packs'"
        />
        <Button v-if="tab === 'models' && can.builder" variant="ghost" @click="go('router')"
          >All models<ArrowRight :size="13"
        /></Button>
      </div>
    </div>

    <template v-if="tab === 'models'">
      <div v-for="n in needs" :key="n.w.workflow" class="mm-env-alert">
        <TriangleAlert :size="16" class="shrink-0" />
        <p class="min-w-0 flex-1">
          <span class="font-medium"
            >{{ n.w.workflow }} is missing {{ n.missing.length }} model{{
              n.missing.length === 1 ? '' : 's'
            }}</span
          >
          <span class="block text-muted-foreground"
            >{{ n.missing.map((x) => x.name).join(', ') }} ·
            {{ fmtSize(n.missing.reduce((s, x) => s + x.sizeGb, 0)) }}</span
          >
        </p>
        <Button size="sm" variant="primary" @click="downloadAll(n.missing.map((x) => x.id))"
          ><Download :size="13" />Download all</Button
        >
      </div>
      <div class="mm-env-list mar-surface">
        <div v-for="x in models" :key="x.id" class="mm-env-row">
          <ModelTile :model="x" :size="30" />
          <span class="min-w-0">
            <span class="block truncate text-ui font-medium">{{ x.name }}</span>
            <span class="block truncate font-mono text-[11px] text-subtle-foreground">{{
              x.file
            }}</span>
          </span>
          <span class="text-ui text-muted-foreground">{{ TYPE_LABEL[x.type] }}</span>
          <span class="text-right text-ui text-subtle-foreground tabular-nums">{{
            fmtSize(x.sizeGb)
          }}</span>
          <ModelStatus :model="x" />
        </div>
        <p v-if="!models.length" class="px-3 py-6 text-center text-ui text-subtle-foreground">
          {{ q ? 'No models match.' : 'No workflow in this build loads a model yet.' }}
        </p>
      </div>
      <p class="mt-2 px-1 text-[12px] text-subtle-foreground">
        {{ fmtSize(size) }} in the shared models folder. Other builds use the same files, so nothing
        is downloaded twice.
      </p>
    </template>
    <div v-else class="mm-env-list mar-surface">
      <div v-for="n in nodes" :key="n.name" class="mm-env-row is-node">
        <span class="flex-1 truncate text-ui">{{ n.name }}</span>
        <span class="text-ui text-subtle-foreground tabular-nums">v{{ n.version }}</span>
        <Badge v-if="!n.updated"><ArrowDownToLine :size="11" />Update</Badge>
        <span v-else class="w-16" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.mm-env-alert {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
  padding: 12px 14px;
  border-radius: 14px;
  background: color-mix(in oklch, var(--color-status-warning, #f5b14c) 11%, transparent);
  font-size: 13px;
}
.mm-env-alert > svg {
  color: var(--color-status-warning, #f5b14c);
}
.mm-env-list {
  padding: 4px;
  border-radius: 16px;
}
.mm-env-row {
  display: grid;
  min-height: 48px;
  grid-template-columns: 30px minmax(0, 1fr) 120px 72px 200px;
  align-items: center;
  gap: 14px;
  padding: 6px 10px;
  border-radius: 12px;
}
.mm-env-row.is-node {
  display: flex;
}
.mm-env-row:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
}
</style>
