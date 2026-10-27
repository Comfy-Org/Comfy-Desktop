<script setup lang="ts">
import { computed } from 'vue'
import { ArrowUpRight, Check, Copy, Loader2, Lock, Rocket, Sparkles, Users } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import GraphPreview from '../GraphPreview.vue'
import AppThemeFrame from './AppThemeFrame.vue'
import FieldList from './FieldList.vue'
import LookStep from './LookStep.vue'
import PreviewAsMenu from './PreviewAsMenu.vue'
import { hostActions, instanceById } from '../../useProto'
import { copyLink, dialogs, flow, libApp, next, openApp, openAppUrl, type Msg } from '../../appFlow'

/**
 * The conversation. Full: each step is a card you act on (Chat view).
 * Compact: each step is one line, because the app itself is on the right
 * (Split view).
 */

const d = computed(() => flow.draft)
const live = computed(() => libApp(flow.appId))
const latest = (m: Msg): boolean =>
  [...flow.messages].reverse().find((x) => x.artifact === m.artifact)?.id === m.id
const bold = (s: string): string =>
  s
    .replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-medium text-base-foreground">$1</strong>')
</script>

<template>
  <div class="flex flex-col gap-7">
    <template v-for="m in flow.messages" :key="m.id">
      <div v-if="m.role === 'user'" class="flex justify-end">
        <p class="max-w-[85%] rounded-card bg-secondary-background px-4 py-2.5 text-ui">
          {{ m.text }}
        </p>
      </div>

      <div v-else class="flex gap-3">
        <span
          class="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary-background"
          ><Sparkles :size="13"
        /></span>
        <div class="min-w-0 flex-1">
          <ul v-if="m.steps?.length" class="mb-2.5 flex flex-col gap-1.5">
            <li
              v-for="(s, i) in m.steps.slice(0, m.shown ?? m.steps.length)"
              :key="s"
              class="flex items-center gap-2 text-ui text-muted-foreground"
            >
              <Loader2
                v-if="m.pending && i === (m.shown ?? 0) - 1"
                :size="13"
                class="animate-spin"
              />
              <Check v-else :size="13" class="text-status-running" />{{ s }}
            </li>
          </ul>
          <template v-if="!m.pending">
            <!-- eslint-disable-next-line vue/no-v-html -- mock copy, escaped above -->
            <p class="text-ui leading-6 text-muted-foreground" v-html="bold(m.text)" />

            <!-- Compact: one line per step -->
            <template v-if="d">
              <!-- Workflow -->
              <Card v-if="m.artifact === 'workflow'" class="mt-3 overflow-hidden">
                <div class="relative aspect-[16/6] border-b border-border-default">
                  <GraphPreview :thumb-id="d.source.thumbId" :zoom="0.5" />
                </div>
                <div class="flex items-center gap-3 px-4 py-3">
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-ui font-medium">{{ d.source.name }}.json</p>
                    <p class="text-ui text-subtle-foreground">
                      {{ d.source.nodes }} nodes · {{ d.source.model }} ·
                      {{ d.fresh ? 'new' : `last run ${d.source.lastRun}` }}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    @click="hostActions.launch(instanceById('local-1')!, d.source.name)"
                    >Open in ComfyUI</Button
                  >
                  <Button
                    v-if="flow.stage === 'workflow' && latest(m)"
                    variant="primary"
                    size="sm"
                    :disabled="flow.busy"
                    @click="next"
                    >Create an app</Button
                  >
                </div>
              </Card>

              <!-- Inputs -->
              <Card v-else-if="m.artifact === 'inputs'" class="mt-3 overflow-hidden">
                <FieldList :editable="latest(m) && flow.stage === 'inputs'" />
                <div
                  v-if="flow.stage === 'inputs' && latest(m)"
                  class="flex items-center gap-3 border-t border-border-default px-4 py-3"
                >
                  <Lock :size="13" class="text-subtle-foreground" />
                  <span class="flex-1 text-ui text-subtle-foreground"
                    >Everything else stays locked. People never see the graph.</span
                  >
                  <Button variant="primary" size="sm" :disabled="flow.busy" @click="next"
                    >Looks right</Button
                  >
                </div>
              </Card>

              <!-- Look: only the latest one is live -->
              <LookStep
                v-else-if="m.artifact === 'layout' && latest(m)"
                :done="flow.stage !== 'layout'"
              />

              <!-- Try it -->
              <div
                v-else-if="m.artifact === 'preview'"
                class="mt-3 overflow-hidden rounded-card border border-border-default"
              >
                <div
                  class="flex items-center justify-between border-b border-border-default px-4 py-2.5 text-ui text-subtle-foreground"
                >
                  <span>Draft · only you see it</span><span>Try it</span>
                </div>
                <AppThemeFrame
                  compact
                  :name="d.name"
                  :blurb="d.blurb"
                  author="Pablo · Silverside"
                  :thumb-id="d.thumbId"
                  :fields="d.fields"
                  :cost="d.cost"
                  payer="Paid by you while it is a draft"
                  :layout="d.layout"
                  :theme="d.theme"
                />
              </div>

              <!-- Publish: the person decides -->
              <div
                v-else-if="m.artifact === 'publish' && !live"
                class="mt-3 flex items-center gap-3 rounded-card border border-border-default px-4 py-3"
              >
                <span class="min-w-0 flex-1 text-ui text-subtle-foreground"
                  >Only you, your team, or anyone with the link.</span
                >
                <Button variant="primary" size="sm" @click="dialogs.publish = true"
                  ><Rocket :size="12" />Publish…</Button
                >
              </div>

              <!-- Live -->
              <Card v-else-if="m.artifact === 'live' && live" class="mt-3 overflow-hidden">
                <div class="flex items-center gap-3 px-4 py-3">
                  <span class="size-2 rounded-full bg-status-running" />
                  <span class="min-w-0 flex-1 truncate font-mono text-ui"
                    >comfy.org/a/{{ live.slug }}</span
                  >
                  <Button variant="ghost" size="sm" @click="copyLink(live)"
                    ><Copy :size="12" />Copy</Button
                  >
                </div>
                <div class="flex items-center gap-2 border-t border-border-default px-4 py-3">
                  <PreviewAsMenu :app-id="live.id" size="sm" />
                  <span class="flex-1" />
                  <Button size="sm" @click="dialogs.share = live.id"
                    ><Users :size="12" />Share…</Button
                  >
                  <Button size="sm" @click="openApp(live.id)">Manage</Button>
                  <Button size="sm" variant="primary" @click="openAppUrl(live.id)"
                    >Open app<ArrowUpRight :size="12"
                  /></Button>
                </div>
              </Card>
            </template>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>
