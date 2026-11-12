<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { ArrowUpCircle, ChevronDown, Copy, FolderOpen, Loader2, Pencil } from 'lucide-vue-next'
import { DropdownMenuPortal, DropdownMenuRoot, DropdownMenuSub, DropdownMenuTrigger } from 'reka-ui'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import DropdownMenuContent from '../../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../../ui/DropdownMenuItem.vue'
import DropdownMenuLabel from '../../ui/DropdownMenuLabel.vue'
import DropdownMenuSubContent from '../../ui/DropdownMenuSubContent.vue'
import DropdownMenuSubTrigger from '../../ui/DropdownMenuSubTrigger.vue'
import SectionHeader from '../../ui/SectionHeader.vue'
import StatTile from '../../parts/env/StatTile.vue'
import { toast } from '../../useProto'
import type { ProtoInstance } from '../../mock'
import BuildAbout from './BuildAbout.vue'
import BuildChannelMenu from './BuildChannelMenu.vue'
import BuildUpdateSummary from './BuildUpdateSummary.vue'
import { factsOf, pendingOf, stateOf, updateBuild } from './buildFacts'
import { changeTorch, torchOptions } from './buildTorch'
import { extraOf } from './m1Builds'
import './buildTabs.css'
import '../tools/tools.css'

/**
 * A build's Overview, from Milestone 3, in the same language as the full
 * build page's Overview: a strip of tiles on top, then sections. A build
 * on this computer shows its two versions as tiles with their action
 * (Update, Change PyTorch), how much room it takes and its Python; then
 * Details in one facts grid. Cloud and Remote keep their facts.
 */
const {
  env,
  own,
  onPage = false
} = defineProps<{
  env: ProtoInstance
  own: boolean
  onPage?: boolean
}>()
const local = computed(() => own && env.kind === 'local')
const facts = factsOf(env)
const state = stateOf(env)
const extra = extraOf(env.id)
const pending = computed(() => pendingOf(env))
const torch = computed(() => torchOptions(env))
const current = computed(() => torch.value.find((t) => t.on)!)
const backend = facts.torch.match(/\((.+)\)/)?.[1] ?? 'CUDA'
const source = env.channel === 'Legacy Desktop' ? 'Desktop (legacy)' : 'Standalone'

const editing = ref(false)
const draft = ref('')
const field = ref<HTMLInputElement>()
async function rename(): Promise<void> {
  draft.value = state.name
  editing.value = true
  await nextTick()
  field.value?.select()
}
function save(): void {
  const v = draft.value.trim()
  if (v) state.name = v
  editing.value = false
}
</script>

<template>
  <template v-if="local">
    <Card class="grid grid-cols-4 divide-x divide-border-default">
      <StatTile label="ComfyUI" :value="state.version">
        <Loader2 v-if="state.updating" :size="16" class="mb-1 animate-spin text-muted-foreground" />
        <Button
          v-else-if="pending"
          size="sm"
          title="Saves a snapshot first"
          @click="updateBuild(env)"
          ><ArrowUpCircle :size="13" />Update</Button
        >
        <template #hint>
          <span class="bus-line">
            <span v-if="state.updating">Updating to {{ pending }}…</span>
            <span v-else-if="pending">{{ pending }} available</span>
            <span v-else>Up to date</span>
            <span aria-hidden="true">·</span>
            <BuildChannelMenu :env />
          </span>
        </template>
      </StatTile>

      <StatTile label="PyTorch" :value="current.v" :hint="`${backend}  ·  official build`">
        <DropdownMenuRoot :modal="false">
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="sm">Change<ChevronDown :size="13" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" :side-offset="6" class="w-72">
            <DropdownMenuLabel>PyTorch</DropdownMenuLabel>
            <template v-for="t in torch" :key="t.v">
              <DropdownMenuItem
                v-if="t.on"
                class="bus-option bg-secondary-background"
                @select.prevent
              >
                <span class="flex min-w-0 flex-col">
                  <span>{{ t.v }}</span>
                  <span class="bus-hint">In use</span>
                </span>
              </DropdownMenuItem>
              <DropdownMenuSub v-else>
                <DropdownMenuSubTrigger class="bus-option">
                  <span class="flex min-w-0 flex-col">
                    <span>{{ t.v }}</span>
                    <span class="bus-hint">{{ t.short }}</span>
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem @select="changeTorch(env, t.v, false)"
                      >Change PyTorch</DropdownMenuItem
                    >
                    <DropdownMenuItem class="bus-option" @select="changeTorch(env, t.v, true)">
                      <span class="flex min-w-0 flex-col">
                        <span>Copy & Change</span>
                        <span class="bus-hint">Keeps {{ state.name }} as it is</span>
                      </span>
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
            </template>
          </DropdownMenuContent>
        </DropdownMenuRoot>
      </StatTile>

      <StatTile label="On disk" :value="facts.disk" hint="412 GB free" />
      <StatTile label="Python" :value="facts.python" :hint="source" />
    </Card>

    <SectionHeader title="Details" class="mar-sec mt-7" />
    <div class="bo-facts">
      <div v-if="!onPage" class="bo-fact">
        <span class="bo-label">Name</span>
        <input
          v-if="editing"
          ref="field"
          v-model="draft"
          class="mar-ab-input"
          aria-label="Instance name"
          @keydown.enter="save"
          @keydown.esc="editing = false"
          @blur="save"
        />
        <span v-else class="bo-value"
          ><span class="truncate">{{ state.name }}</span
          ><Button
            variant="ghost"
            size="icon-xs"
            aria-label="Edit instance name"
            title="Edit instance name"
            @click="rename"
            ><Pencil :size="13" /></Button
        ></span>
      </div>
      <div class="bo-fact">
        <span class="bo-label">Location</span>
        <span class="bo-value bo-path"
          ><span class="truncate">{{ facts.path }}</span
          ><Button
            variant="ghost"
            size="icon-xs"
            aria-label="Open folder"
            title="Open folder"
            @click="toast(`Opened ${facts.path}`)"
            ><FolderOpen :size="13" /></Button
          ><Button
            variant="ghost"
            size="icon-xs"
            aria-label="Copy path"
            title="Copy path"
            @click="toast('Path copied')"
            ><Copy :size="13" /></Button
        ></span>
      </div>
      <div v-if="extra.from" class="bo-fact">
        <span class="bo-label">{{ extra.from.how }} from</span>
        <span class="bo-value">{{ extra.from.name }} · Oct 28</span>
      </div>
      <div v-if="state.run === 'running'" class="bo-fact">
        <span class="bo-label">Port</span>
        <span class="bo-value tabular-nums">8188</span>
      </div>
    </div>
  </template>

  <template v-else>
    <BuildUpdateSummary v-if="own" :env />
    <BuildAbout :env :combined="own" :on-page />
  </template>
</template>

<style scoped>
.bo-facts {
  display: flex;
  max-width: 760px;
  flex-direction: column;
}
.bo-fact {
  display: grid;
  min-height: 36px;
  grid-template-columns: 140px minmax(0, 1fr);
  align-items: center;
  gap: 16px;
}
.bo-label {
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
.bo-value {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 2px;
  color: var(--color-base-foreground);
  font-size: 13px;
}
.bo-path > .truncate {
  margin-right: 6px;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
}
</style>
