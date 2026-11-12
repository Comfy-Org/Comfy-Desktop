<script setup lang="ts">
import { computed, reactive } from 'vue'
import {
  CircleHelp,
  Download,
  Folder,
  FolderLock,
  Lock,
  Plus,
  RotateCcw,
  Trash2
} from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import SettingsSection from '../../ui/SettingsSection.vue'
import Switch from '../../ui/Switch.vue'
import Tooltip from '../../ui/Tooltip.vue'
import { toast } from '../../useProto'
import type { ProtoInstance } from '../../mock'
import MarItemMenu from '../pages/MarItemMenu.vue'
import type { MenuLine } from '../pages/menu'
import { notify } from '../pages/undo'
import { settingsOf, stateOf } from './buildFacts'
import './buildTabs.css'

/**
 * Desktop's Storage tab (views/comfyUISettings/StoragePane.vue): Models,
 * every folder this build reads from (its own always, the shared ones
 * when included, one marked for downloads), then Input and Output, each
 * one folder you can open, browse for or reset. Shared folders are
 * managed in Desktop Settings. On Cloud, what the workspace keeps.
 */
const { env } = defineProps<{ env: ProtoInstance }>()
const set = settingsOf(env)
const state = stateOf(env)
const cloud = env.kind === 'cloud'

const SHARED = ['~/Documents/ComfyUI/models', '/Volumes/Studio/models']
const extra = reactive<string[]>([])
const downloads = reactive({ path: set.modelDirs[0]! })
const dirs = computed(() => [
  { path: set.modelDirs[0]!, tag: 'Build', locked: true },
  ...extra.map((path) => ({ path, tag: '', locked: false })),
  ...(set.sharedModels ? SHARED.map((path) => ({ path, tag: 'Shared', locked: true })) : [])
])
const home = `~/Documents/ComfyUI/${env.name}`
const changed = (): void => {
  if (state.run === 'running') state.restart = true
}
function useForDownloads(path: string): void {
  const was = downloads.path
  downloads.path = path
  changed()
  notify(`Model downloads go to ${path}`, () => (downloads.path = was))
}
const lines = (d: { path: string; locked: boolean }): MenuLine[] => [
  {
    label: 'Use for Model Downloads',
    icon: Download,
    disabled: downloads.path === d.path,
    run: () => useForDownloads(d.path)
  },
  ...(d.locked
    ? [{ note: 'This directory is always used and cannot be removed.' }]
    : [
        'sep' as const,
        {
          label: 'Remove',
          icon: Trash2,
          danger: true,
          run: () => {
            const i = extra.indexOf(d.path)
            extra.splice(i, 1)
            changed()
            notify(`Removed ${d.path}`, () => extra.splice(i, 0, d.path))
          }
        }
      ])
]
function add(): void {
  extra.push('~/AI/models')
  changed()
  notify('Added ~/AI/models', () => extra.pop())
}
const io = reactive({ input: set.inputDir, output: set.outputDir })
function setFolder(k: 'input' | 'output', path: string): void {
  const was = io[k]
  io[k] = path
  changed()
  notify(`${k === 'input' ? 'Input' : 'Output'} folder: ${path}`, () => (io[k] = was))
}
const manage = (): void => toast('Opening Desktop Settings › Shared Directories')
const openPath = (path: string): void => toast(`Opened ${path}`)
const TIPS = {
  models:
    'When enabled, this build can see every model in your global shared model folders, in addition to any directories added for this build below. Disabling hides the shared models - most users want this on.',
  input:
    'When enabled, this build reads input files from the global shared input folder. Disable to point this build at its own input folder below.',
  output:
    'When enabled, this build writes generated outputs to the global shared output folder. Disable to point this build at its own output folder below.',
  downloads: 'Newly downloaded models are saved here.',
  build: "This build's own models folder. It's always used and is never shared with other builds."
}
</script>

<template>
  <Card v-if="cloud" class="mar-bt-row">
    <Folder :size="16" class="shrink-0 text-subtle-foreground" />
    <div class="min-w-0 flex-1">
      <p class="mar-bt-title">Kept in your Comfy Cloud workspace</p>
      <p class="mar-bt-sub">
        Models, inputs and outputs live in the cloud, with nothing to set up.
      </p>
    </div>
  </Card>
  <div v-else class="mar-bt-settings">
    <p v-if="state.restart" class="mar-bt-note">
      Restart {{ env.name }} for these changes to take effect.
    </p>
    <SettingsSection
      title="Models"
      description="Every model directory this build reads: the shared directories it includes, any directories added just for this build, and its own internal models folder."
    >
      <template #actions>
        <label class="mar-st-toggle"
          ><span class="mar-st-tip"
            >Include Shared Directories<Tooltip wrap :content="TIPS.models"
              ><CircleHelp :size="13" /></Tooltip></span
          ><Switch
            v-model="set.sharedModels"
            aria-label="Include Shared Directories"
            @update:model-value="changed"
        /></label>
      </template>
      <div v-for="d in dirs" :key="d.path" class="mar-bt-folder">
        <component
          :is="d.tag === 'Build' ? FolderLock : Folder"
          :size="14"
          class="shrink-0 text-subtle-foreground"
        />
        <button type="button" class="mar-st-path" :title="d.path" @click="openPath(d.path)">
          {{ d.path }}
        </button>
        <span v-if="downloads.path === d.path" class="mar-tag mar-st-tag"
          >Downloads<Tooltip wrap :content="TIPS.downloads"><CircleHelp :size="12" /></Tooltip
        ></span>
        <span v-if="d.tag === 'Build'" class="mar-tag mar-st-tag"
          ><Lock :size="11" />Build<Tooltip wrap :content="TIPS.build"
            ><CircleHelp :size="12" /></Tooltip
        ></span>
        <span v-else-if="d.tag" class="mar-tag">{{ d.tag }}</span>
        <MarItemMenu :lines="lines(d)" label="More actions" />
      </div>
      <div class="flex items-center gap-4 px-5 py-3">
        <Button variant="ghost" size="sm" @click="add"><Plus :size="13" />Add Directory</Button>
        <button v-if="set.sharedModels" type="button" class="mar-st-link" @click="manage">
          Manage Shared Directories in Desktop Settings
        </button>
      </div>
    </SettingsSection>

    <SettingsSection
      v-for="k in ['input', 'output'] as const"
      :key="k"
      :title="k === 'input' ? 'Input' : 'Output'"
    >
      <template #actions>
        <label class="mar-st-toggle"
          ><span class="mar-st-tip"
            >{{ k === 'input' ? 'Use Shared Input' : 'Use Shared Output'
            }}<Tooltip wrap :content="TIPS[k]"><CircleHelp :size="13" /></Tooltip></span
          ><Switch
            v-if="k === 'input'"
            v-model="set.sharedInput"
            aria-label="Use Shared Input"
            @update:model-value="changed" /><Switch
            v-else
            v-model="set.sharedOutput"
            aria-label="Use Shared Output"
            @update:model-value="changed"
        /></label>
      </template>
      <div class="mar-bt-folder">
        <Folder :size="14" class="shrink-0 text-subtle-foreground" />
        <template v-if="k === 'input' ? set.sharedInput : set.sharedOutput">
          <button type="button" class="mar-st-path" @click="openPath(`~/Documents/ComfyUI/${k}`)">
            ~/Documents/ComfyUI/{{ k }}
          </button>
          <span class="mar-tag">Shared</span>
          <Button variant="ghost" size="sm" @click="manage">Manage</Button>
        </template>
        <template v-else>
          <button type="button" class="mar-st-path" @click="openPath(io[k])">{{ io[k] }}</button>
          <span v-if="io[k] === `${home}/${k}`" class="mar-tag">default</span>
          <Button variant="ghost" size="sm" @click="setFolder(k, `/Volumes/Studio/${k}`)"
            >Browse</Button
          >
          <Button
            v-if="io[k] !== `${home}/${k}`"
            variant="ghost"
            size="sm"
            @click="setFolder(k, `${home}/${k}`)"
            ><RotateCcw :size="13" />Reset to default</Button
          >
        </template>
      </div>
    </SettingsSection>
  </div>
</template>
