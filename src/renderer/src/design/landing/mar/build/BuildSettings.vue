<script setup lang="ts">
import { computed } from 'vue'
import { Folder, Plus, X } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Input from '../../ui/Input.vue'
import Select from '../../ui/Select.vue'
import SettingsRow from '../../ui/SettingsRow.vue'
import SettingsSection from '../../ui/SettingsSection.vue'
import Switch from '../../ui/Switch.vue'
import { toast } from '../../useProto'
import type { ProtoInstance } from '../../mock'
import { notify } from '../pages/undo'
import {
  LAUNCH_MODES,
  NETWORK,
  PARTITIONS,
  PORT_CONFLICT,
  SECURITY,
  settingsOf
} from './buildFacts'
import './buildTabs.css'

/**
 * Production's Settings (ComfyUISettingsContent: Launch Settings, then
 * Storage) as one scrolling page in the New UI. Startup first: arguments,
 * how it opens, environment variables and ComfyUI-Manager; then Storage:
 * model directories, input and output. Names are production's.
 */
const { env } = defineProps<{ env: ProtoInstance }>()
const set = settingsOf(env)

const securityHint = computed(() => SECURITY.find((s) => s.value === set.security)!.hint)
const networkHint = computed(() => NETWORK.find((s) => s.value === set.network)!.hint)

function removeVar(i: number): void {
  const v = set.env.splice(i, 1)[0]!
  if (v.key) notify(`Removed ${v.key}`, () => set.env.splice(i, 0, v))
}
function addDir(): void {
  set.modelDirs.push('~/AI/models')
  toast('Added ~/AI/models')
}
function removeDir(i: number): void {
  const d = set.modelDirs.splice(i, 1)[0]!
  notify(`Removed ${d}`, () => set.modelDirs.splice(i, 0, d))
}
</script>

<template>
  <div class="mar-bt-settings">
    <h2 class="mar-bt-h2">Startup</h2>
    <p class="mar-bt-lead">Changes apply the next time {{ env.name }} starts.</p>
    <SettingsSection title="Launch Settings" description="How ComfyUI starts and where it opens.">
      <SettingsRow label="Startup Arguments" hint="Passed to ComfyUI as it starts.">
        <Input v-model="set.args" mono aria-label="Startup Arguments" />
      </SettingsRow>
      <SettingsRow label="Launch Mode" layout="inline">
        <Select v-model="set.mode" :options="LAUNCH_MODES" class="w-44" />
      </SettingsRow>
      <SettingsRow label="Browser Cache" layout="inline">
        <Select v-model="set.partition" :options="PARTITIONS" class="w-52" />
      </SettingsRow>
      <SettingsRow label="If Port is Busy" layout="inline">
        <Select v-model="set.portConflict" :options="PORT_CONFLICT" class="w-52" />
      </SettingsRow>
    </SettingsSection>

    <SettingsSection
      title="Environment Variables"
      description="Set for ComfyUI and its custom nodes, in this build only."
    >
      <div v-for="(v, i) in set.env" :key="i" class="mar-bt-var">
        <Input v-model="v.key" mono placeholder="NAME" aria-label="Variable name" />
        <span class="text-subtle-foreground">=</span>
        <Input v-model="v.value" mono placeholder="value" aria-label="Variable value" />
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="`Remove ${v.key || 'variable'}`"
          @click="removeVar(i)"
          ><X :size="14"
        /></Button>
      </div>
      <div class="px-5 py-3">
        <Button variant="ghost" size="sm" @click="set.env.push({ key: '', value: '' })"
          ><Plus :size="13" />Add variable</Button
        >
      </div>
    </SettingsSection>

    <SettingsSection
      title="ComfyUI-Manager"
      description="Installs and updates node packs from inside ComfyUI."
    >
      <SettingsRow label="Manager Security Level" layout="inline" :hint="securityHint">
        <Select v-model="set.security" :options="SECURITY" class="w-52" />
      </SettingsRow>
      <SettingsRow label="Manager Network Mode" layout="inline" :hint="networkHint">
        <Select v-model="set.network" :options="NETWORK" class="w-52" />
      </SettingsRow>
    </SettingsSection>

    <h2 class="mar-bt-h2 mt-10">Storage</h2>
    <p class="mar-bt-lead">Where this build finds models and keeps what it makes.</p>
    <SettingsSection
      title="Model Directories"
      description="ComfyUI looks for models in every folder here."
    >
      <SettingsRow
        label="Include Shared Model Directories"
        layout="inline"
        hint="Also use the model folders every build shares."
      >
        <Switch v-model="set.sharedModels" aria-label="Include Shared Model Directories" />
      </SettingsRow>
      <div v-for="(d, i) in set.modelDirs" :key="d" class="mar-bt-folder">
        <Folder :size="14" class="shrink-0 text-subtle-foreground" />
        <span class="min-w-0 flex-1 truncate font-mono">{{ d }}</span>
        <Button
          v-if="i > 0"
          variant="ghost"
          size="icon-sm"
          :aria-label="`Remove ${d}`"
          @click="removeDir(i)"
          ><X :size="14"
        /></Button>
      </div>
      <div class="px-5 py-3">
        <Button variant="ghost" size="sm" @click="addDir"><Plus :size="13" />Add folder</Button>
      </div>
    </SettingsSection>

    <SettingsSection title="Input and Output" description="Where images go in and come out.">
      <SettingsRow label="Use Shared Input Folder" layout="inline">
        <Switch v-model="set.sharedInput" aria-label="Use Shared Input Folder" />
      </SettingsRow>
      <SettingsRow v-if="!set.sharedInput" label="Input Directory" layout="inline">
        <span class="mar-bt-path">{{ set.inputDir }}</span>
        <Button size="sm" @click="toast('Choose the input folder')">Change</Button>
      </SettingsRow>
      <SettingsRow label="Use Shared Output Folder" layout="inline">
        <Switch v-model="set.sharedOutput" aria-label="Use Shared Output Folder" />
      </SettingsRow>
      <SettingsRow v-if="!set.sharedOutput" label="Output Directory" layout="inline">
        <span class="mar-bt-path">{{ set.outputDir }}</span>
        <Button size="sm" @click="toast('Choose the output folder')">Change</Button>
      </SettingsRow>
    </SettingsSection>
  </div>
</template>
