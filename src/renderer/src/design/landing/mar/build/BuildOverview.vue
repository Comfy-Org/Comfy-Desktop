<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { ArrowUpCircle, ChevronDown, Copy, FolderOpen, Loader2, Pencil } from 'lucide-vue-next'
import { DropdownMenuPortal, DropdownMenuRoot, DropdownMenuSub, DropdownMenuTrigger } from 'reka-ui'
import Button from '../../ui/Button.vue'
import DropdownMenuContent from '../../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../../ui/DropdownMenuItem.vue'
import DropdownMenuLabel from '../../ui/DropdownMenuLabel.vue'
import DropdownMenuSubContent from '../../ui/DropdownMenuSubContent.vue'
import DropdownMenuSubTrigger from '../../ui/DropdownMenuSubTrigger.vue'
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
    <div class="bo-grid">
      <section class="bo-cell bo-main" aria-label="ComfyUI">
        <span class="bo-label">ComfyUI</span>
        <span class="bo-num">{{ state.version }}</span>
        <BuildChannelMenu :env />
        <div class="bo-update">
          <template v-if="state.updating">
            <Loader2 :size="14" class="animate-spin" />
            <span>Updating to {{ pending }}…</span>
          </template>
          <template v-else-if="pending">
            <span class="flex min-w-0 flex-col">
              <span class="text-base-foreground">{{ pending }} available</span>
              <span>Saves a snapshot first</span>
            </span>
            <Button size="sm" class="ml-auto" @click="updateBuild(env)"
              ><ArrowUpCircle :size="13" />Update</Button
            >
          </template>
          <span v-else>Up to date</span>
        </div>
      </section>

      <section class="bo-cell" aria-label="PyTorch">
        <span class="bo-label">PyTorch</span>
        <span class="bo-num">{{ current.v }}</span>
        <span class="bo-row bo-foot"
          ><span class="bo-hint">{{ backend }} · official build</span>
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
        </span>
      </section>

      <section class="bo-cell" aria-label="On disk">
        <span class="bo-label">On disk</span>
        <span class="bo-num">{{ facts.disk }}</span>
        <span class="bo-hint">412 GB free</span>
      </section>

      <section class="bo-cell" aria-label="Python">
        <span class="bo-label">Python</span>
        <span class="bo-num">{{ facts.python }}</span>
        <span class="bo-hint">{{ source }}</span>
      </section>

      <section class="bo-cell bo-facts" aria-label="Details">
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
      </section>
    </div>
  </template>

  <template v-else>
    <BuildUpdateSummary v-if="own" :env />
    <BuildAbout :env :combined="own" :on-page />
  </template>
</template>

<style scoped>
/* Option A: each fact its own card. ComfyUI is the tall one and carries
   the update; the facts (Location, Port…) take the wide card. No lines. */
.bo-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.bo-cell {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
  border-radius: 14px;
  background: color-mix(in oklch, var(--color-base-foreground) 5%, var(--color-content-background));
  padding: 16px 18px;
}
.bo-main {
  grid-row: span 2;
}
.bo-facts {
  grid-column: span 3;
  justify-content: center;
  gap: 0;
  padding-block: 8px;
}
.bo-label,
.bo-hint {
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
.bo-num {
  color: var(--color-base-foreground);
  font-size: 22px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
  line-height: 28px;
}
.bo-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.bo-foot {
  margin-top: auto;
  margin-right: -8px;
  margin-bottom: -6px;
}
.bo-main > :deep(button) {
  align-self: flex-start;
}
.bo-update {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: auto;
  padding-top: 20px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
.bo-fact {
  display: grid;
  min-height: 36px;
  grid-template-columns: 110px minmax(0, 1fr);
  align-items: center;
  gap: 16px;
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
  margin-right: auto;
  padding-right: 12px;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
}
@media (max-width: 760px) {
  .bo-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .bo-main {
    grid-row: auto;
  }
  .bo-grid > .bo-facts {
    grid-column: 1 / -1;
  }
}
</style>
