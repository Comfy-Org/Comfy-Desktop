<script setup lang="ts">
import { computed, reactive } from 'vue'
import { Download, Folder, FolderOpen, Plus, RotateCcw, Trash2 } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import SettingsSection from '../../ui/SettingsSection.vue'
import Switch from '../../ui/Switch.vue'
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
  { path: set.modelDirs[0]!, tag: 'Instance', locked: true },
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
  { label: 'Open folder', icon: FolderOpen, run: () => toast(`Opened ${d.path}`) },
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
    <SettingsSection title="Models" description="ComfyUI looks for models in every folder here.">
      <template #actions>
        <label class="mar-st-toggle"
          >Include Shared Directories<Switch
            v-model="set.sharedModels"
            aria-label="Include Shared Directories"
            @update:model-value="changed"
        /></label>
      </template>
      <div v-for="d in dirs" :key="d.path" class="mar-bt-folder">
        <Folder :size="14" class="shrink-0 text-subtle-foreground" />
        <span class="min-w-0 flex-1 truncate font-mono">{{ d.path }}</span>
        <span v-if="downloads.path === d.path" class="mar-tag">Downloads</span>
        <span v-if="d.tag" class="mar-tag">{{ d.tag }}</span>
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
          >{{ k === 'input' ? 'Use Shared Input' : 'Use Shared Output'
          }}<Switch
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
          <span class="min-w-0 flex-1 truncate font-mono">~/Documents/ComfyUI/{{ k }}</span>
          <span class="mar-tag">Shared</span>
          <Button variant="ghost" size="sm" @click="toast(`Opened the shared ${k} folder`)"
            >Open folder</Button
          >
          <Button variant="ghost" size="sm" @click="manage">Manage</Button>
        </template>
        <template v-else>
          <span class="min-w-0 flex-1 truncate font-mono">{{ io[k] }}</span>
          <span v-if="io[k] === `${home}/${k}`" class="mar-tag">default</span>
          <Button variant="ghost" size="sm" @click="toast(`Opened ${io[k]}`)">Open folder</Button>
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
