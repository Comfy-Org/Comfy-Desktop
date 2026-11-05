<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Copy, FolderOpen, Pencil } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import { toast } from '../../useProto'
import type { ProtoInstance } from '../../mock'
import { extraOf, isRemote } from './m1Builds'
import { factsOf, stateOf } from './buildFacts'
import './buildTabs.css'

/**
 * Desktop's About tab (views/comfyUISettings/StatusFactPanel.vue): the
 * name, editable (not on Cloud), then its facts in groups: the instance,
 * how it runs while it runs, where it lives and how much room it takes,
 * and where it came from. A remote build's address is editable here.
 */
const { env } = defineProps<{ env: ProtoInstance }>()
const facts = factsOf(env)
const state = stateOf(env)
const extra = extraOf(env.id)
const remote = isRemote(env)
const cloud = env.kind === 'cloud' && !remote

const source = remote
  ? 'Remote'
  : cloud
    ? 'Comfy Cloud'
    : env.channel === 'Legacy Desktop'
      ? 'Desktop (legacy)'
      : 'Standalone'

type Fact = { label: string; value: string; path?: boolean }
const GROUPS = computed(() =>
  [
    {
      title: 'Instance details',
      facts: [
        { label: 'Source', value: source },
        { label: 'Current Version', value: cloud ? 'Managed by Comfy' : state.version },
        ...(remote || cloud
          ? []
          : [
              { label: 'Python', value: facts.python },
              { label: 'PyTorch', value: facts.torch }
            ])
      ] as Fact[]
    },
    {
      title: 'Running details',
      facts: (state.run === 'running' && !cloud ? [{ label: 'Port', value: '8188' }] : []) as Fact[]
    },
    {
      title: 'Location & storage',
      facts: (env.kind === 'local'
        ? [
            { label: 'Location', value: facts.path, path: true },
            { label: 'Disk Usage', value: `${facts.disk} · 412 GB free` }
          ]
        : []) as Fact[]
    },
    {
      title: 'Lineage',
      facts: (extra.from
        ? [{ label: `${extra.from.how} From`, value: `${extra.from.name}  ·  Oct 28` }]
        : []) as Fact[]
    }
  ].filter((g) => g.facts.length)
)

// Rename in place; Enter keeps it, Esc puts it back.
const editing = ref<'' | 'name' | 'url'>('')
const draft = ref('')
const field = ref<HTMLInputElement>()
async function edit(what: 'name' | 'url'): Promise<void> {
  draft.value = what === 'name' ? state.name : (extra.remote ?? '')
  editing.value = what
  await nextTick()
  field.value?.select()
}
function save(): void {
  const v = draft.value.trim()
  if (v && editing.value === 'name') state.name = v
  if (v && editing.value === 'url' && v !== extra.remote) {
    extra.remote = v
    if (state.run === 'running') state.restart = true
  }
  editing.value = ''
}
</script>

<template>
  <div class="mar-ab">
    <div class="mar-ab-hero">
      <input
        v-if="editing === 'name'"
        ref="field"
        v-model="draft"
        class="mar-ab-input is-name"
        aria-label="Instance name"
        @keydown.enter="save"
        @keydown.esc="editing = ''"
        @blur="save"
      />
      <template v-else>
        <h2 class="mar-ab-name">{{ state.name }}</h2>
        <Button
          v-if="!cloud"
          variant="ghost"
          size="icon-xs"
          aria-label="Edit instance name"
          title="Edit instance name"
          @click="edit('name')"
          ><Pencil :size="13"
        /></Button>
      </template>
      <span class="mar-tag">{{ source }}</span>
    </div>

    <Card v-if="remote" class="mar-ab-group">
      <p class="mar-ab-title">Connection</p>
      <div class="mar-ab-fact">
        <span class="mar-bt-fact-label">URL</span>
        <input
          v-if="editing === 'url'"
          ref="field"
          v-model="draft"
          class="mar-ab-input font-mono"
          aria-label="Connection URL"
          @keydown.enter="save"
          @keydown.esc="editing = ''"
          @blur="save"
        />
        <span v-else class="mar-ab-value font-mono"
          >{{ extra.remote
          }}<Button
            variant="ghost"
            size="icon-xs"
            aria-label="Edit connection URL"
            title="Edit connection URL"
            @click="edit('url')"
            ><Pencil :size="13" /></Button
          ><span v-if="state.restart" class="mar-tag">Restart to apply</span></span
        >
      </div>
    </Card>

    <Card v-for="g in GROUPS" :key="g.title" class="mar-ab-group">
      <p class="mar-ab-title">{{ g.title }}</p>
      <div v-for="f in g.facts" :key="f.label" class="mar-ab-fact">
        <span class="mar-bt-fact-label">{{ f.label }}</span>
        <span class="mar-ab-value" :class="f.path && 'font-mono'">
          <span class="truncate">{{ f.value }}</span>
          <template v-if="f.path">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Open folder"
              title="Open folder"
              @click="toast(`Opened ${f.value}`)"
              ><FolderOpen :size="13"
            /></Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Copy path"
              title="Copy path"
              @click="toast('Path copied')"
              ><Copy :size="13"
            /></Button>
          </template>
        </span>
      </div>
    </Card>
  </div>
</template>
