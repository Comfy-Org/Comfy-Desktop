<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowUpCircle, ChevronDown, Copy, FolderOpen, Loader2 } from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuSub, DropdownMenuTrigger } from 'reka-ui'
import Button from '../../ui/Button.vue'
import DropdownMenuContent from '../../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../../ui/DropdownMenuItem.vue'
import DropdownMenuSubContent from '../../ui/DropdownMenuSubContent.vue'
import DropdownMenuSubTrigger from '../../ui/DropdownMenuSubTrigger.vue'
import { toast } from '../../useProto'
import type { ProtoInstance } from '../../mock'
import { notify } from '../pages/undo'
import MarSplitButton from '../pages/MarSplitButton.vue'
import { CHANNELS, factsOf, pendingOf, stateOf, updateBuild } from './buildFacts'
import { runOp } from './buildOps'
import { extraOf } from './m1Builds'

/**
 * Desktop's Overview tab (Comfy-Desktop#2062, views/comfyUISettings/
 * BuildOverview.vue): the build's facts as cards, in place of Update and
 * About. ComfyUI on the left, as tall as the right column: the version,
 * the channel menu, then one status line beside its button (Update, with
 * Copy & Update in its menu, or Check for updates). On the right PyTorch
 * (Change ⌄), On disk and Python, over one wide card: Location, Copied
 * from, Port while it runs. Under 760px the ComfyUI card takes the row.
 * Fills a step lighter, radius 14, no lines; card titles in sentence case.
 */
const { env } = defineProps<{ env: ProtoInstance }>()
const facts = factsOf(env)
const state = stateOf(env)
const extra = extraOf(env.id)
const pending = computed(() => pendingOf(env))
const channel = computed(() => CHANNELS.find((c) => c.value === state.channel)!)

// "v0.37.6-12-g4f2a91c": the tag big, the commits past it beside it.
const version = computed(() => {
  const [main = state.version, ahead] = state.version.split('-')
  return { main, rest: ahead && /^\d+$/.test(ahead) ? `${ahead} commits ahead` : '' }
})

function setChannel(c: (typeof CHANNELS)[number]): void {
  const was = state.channel
  if (c.value === was) return
  state.channel = c.value
  notify(`Update channel: ${c.label}`, () => (state.channel = was))
}

// Check for updates: a moment of checking, then "Checked just now".
const checking = ref(false)
const checked = ref(facts.checked)
function check(): void {
  checking.value = true
  setTimeout(() => {
    checking.value = false
    checked.value = 'just now'
  }, 900)
}
const copyUpdate = computed(() => [
  {
    label: 'Copy & Update',
    run: () =>
      runOp(env.id, {
        title: `Copying ${state.name} and updating to ${pending.value}…`,
        done: 'Copy complete'
      })
  }
])

const torchVersion = facts.torch.split(/[+ ]/)[0]!
const TORCH = [
  {
    label: 'PyTorch 2.10',
    versions: [
      { v: '2.10.0', note: '2.4 GB download' },
      {
        v: '2.11.0.dev',
        note: 'Nightly build: unstable, installable for about 60 days after publication'
      }
    ]
  }
]
function changeTorch(v: string, copy: boolean): void {
  runOp(env.id, {
    title: copy ? `Copying and changing PyTorch to ${v}…` : `Changing PyTorch to ${v}…`,
    done: copy ? 'Copy complete' : 'PyTorch changed'
  })
}
</script>

<template>
  <div class="mar-bo">
    <div class="mar-bo-grid">
      <section class="mar-bo-card is-comfy" aria-label="ComfyUI">
        <span class="mar-bo-label">ComfyUI</span>
        <span class="flex min-w-0 items-baseline gap-2">
          <span class="mar-bo-big" :title="version.main">{{ version.main }}</span>
          <span v-if="version.rest" class="mar-bo-note truncate">{{ version.rest }}</span>
        </span>
        <DropdownMenuRoot :modal="false">
          <DropdownMenuTrigger class="mar-bo-pick" aria-label="Update channel"
            >{{ channel.label }}<ChevronDown :size="13"
          /></DropdownMenuTrigger>
          <DropdownMenuContent align="start" :side-offset="6" class="w-64">
            <p class="mar-bo-menu-head">Update channel</p>
            <div class="flex flex-col gap-0.5">
              <DropdownMenuItem
                v-for="c in CHANNELS"
                :key="c.value"
                class="mar-bo-option"
                :class="c.value === state.channel && 'is-picked'"
                @select="setChannel(c)"
              >
                <span class="flex min-w-0 flex-col">
                  <span>{{ c.label }}</span>
                  <span class="mar-bo-note">{{ c.hint }}</span>
                </span>
              </DropdownMenuItem>
            </div>
          </DropdownMenuContent>
        </DropdownMenuRoot>

        <div class="mar-bo-status">
          <span class="flex min-w-0 flex-1 flex-col">
            <template v-if="pending">
              <span class="mar-bo-strong truncate">{{ pending }} available</span>
              <span class="truncate">Saves a snapshot first · Checked {{ checked }}</span>
            </template>
            <template v-else>
              <span class="mar-bo-strong truncate">Up to date</span>
              <span class="truncate">{{ checking ? 'Checking…' : `Checked ${checked}` }}</span>
            </template>
          </span>
          <MarSplitButton
            v-if="pending"
            label="Update"
            :icon="ArrowUpCircle"
            :lines="copyUpdate"
            menu-label="More update options"
            @run="updateBuild(env)"
          />
          <Button v-else variant="subtle" :disabled="checking" @click="check"
            ><Loader2 v-if="checking" :size="13" class="animate-spin motion-reduce:animate-none" />
            Check for updates</Button
          >
        </div>
      </section>

      <div class="mar-bo-facts">
        <section class="mar-bo-card" aria-label="PyTorch">
          <span class="mar-bo-label">PyTorch</span>
          <span class="mar-bo-big">{{ torchVersion }}</span>
          <span class="mt-auto flex min-w-0 items-center justify-between gap-2">
            <span class="mar-bo-note truncate" :title="env.gpu ?? facts.hardware">{{
              env.gpu ?? facts.hardware
            }}</span>
            <DropdownMenuRoot :modal="false">
              <DropdownMenuTrigger class="mar-bo-pick is-end"
                >Change<ChevronDown :size="13"
              /></DropdownMenuTrigger>
              <DropdownMenuContent align="end" :side-offset="6" class="w-64">
                <template v-for="g in TORCH" :key="g.label">
                  <p class="mar-bo-menu-head">{{ g.label }}</p>
                  <div class="flex flex-col gap-0.5">
                    <DropdownMenuItem class="mar-bo-option is-picked" @select.prevent>
                      <span class="flex min-w-0 flex-col">
                        <span>{{ torchVersion }}</span>
                        <span class="mar-bo-note">In use</span>
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuSub v-for="t in g.versions" :key="t.v">
                      <DropdownMenuSubTrigger class="mar-bo-option">
                        <span class="flex min-w-0 flex-col">
                          <span>{{ t.v }}</span>
                          <span class="mar-bo-note line-clamp-2">{{ t.note }}</span>
                        </span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent class="min-w-48">
                        <DropdownMenuItem @select="changeTorch(t.v, false)"
                          >Change PyTorch</DropdownMenuItem
                        >
                        <DropdownMenuItem @select="changeTorch(t.v, true)"
                          >Copy & Change PyTorch</DropdownMenuItem
                        >
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  </div>
                </template>
              </DropdownMenuContent>
            </DropdownMenuRoot>
          </span>
        </section>

        <section class="mar-bo-card" aria-label="On disk">
          <span class="mar-bo-label">On disk</span>
          <span class="mar-bo-big">{{ facts.disk }}</span>
          <span class="mar-bo-note truncate">412 GB free</span>
        </section>

        <section class="mar-bo-card" aria-label="Python">
          <span class="mar-bo-label">Python</span>
          <span class="mar-bo-big">{{ facts.python }}</span>
          <span class="mar-bo-note truncate">{{ facts.method }}</span>
        </section>

        <section class="mar-bo-card is-wide" aria-label="Details">
          <div class="mar-bo-row">
            <span class="mar-bo-label">Location</span>
            <span class="flex min-w-0 items-center gap-0.5">
              <span class="mar-bo-path" :title="facts.path">{{ facts.path }}</span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Open folder"
                title="Open folder"
                @click="toast(`Opened ${facts.path}`)"
                ><FolderOpen :size="14"
              /></Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Copy path"
                title="Copy path"
                @click="toast('Path copied')"
                ><Copy :size="14"
              /></Button>
            </span>
          </div>
          <div v-if="extra.from" class="mar-bo-row">
            <span class="mar-bo-label">{{ extra.from.how }} from</span>
            <span class="mar-bo-value">{{ extra.from.name }}</span>
          </div>
          <div v-if="state.run === 'running'" class="mar-bo-row">
            <span class="mar-bo-label">Port</span>
            <span class="mar-bo-value tabular-nums">8188</span>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style>
.mar-bo {
  container: mar-bo / inline-size;
  width: 100%;
}
.mar-bo-grid {
  display: grid;
  gap: 10px;
}
@container mar-bo (min-width: 760px) {
  .mar-bo-grid {
    grid-template-columns: minmax(0, 1.35fr) minmax(0, 3fr);
  }
  /* Its content never sets the row: the right column does. */
  .mar-bo-card.is-comfy {
    contain: size;
  }
}
.mar-bo-facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-self: start;
  gap: 10px;
}
.mar-bo-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
  overflow: hidden;
  padding: 16px 18px;
  border-radius: 14px;
  background: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
}
.mar-bo-card.is-wide {
  grid-column: 1 / -1;
  justify-content: center;
  padding-block: 8px;
}
.mar-bo-label {
  color: var(--color-muted-foreground);
  font-size: 12px;
  line-height: 16px;
}
.mar-bo-big {
  overflow: hidden;
  color: var(--color-base-foreground);
  font-size: 22px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
  line-height: 28px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mar-bo-note {
  color: var(--color-muted-foreground);
  font-size: 12px;
  line-height: 16px;
}
.mar-bo-strong {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-bo-pick {
  display: inline-flex;
  max-width: calc(100% + 1rem);
  align-items: center;
  align-self: flex-start;
  gap: 2px;
  margin: 2px -8px 0;
  padding: 4px 8px;
  border-radius: var(--radius-control);
  color: var(--color-muted-foreground);
  font-size: 12px;
  line-height: 16px;
  transition:
    background-color 140ms ease,
    color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-bo-pick.is-end {
  margin: -6px -8px -6px 0;
  flex-shrink: 0;
}
:root .proto-ui.proto-ui.proto-ui .mar-bo-pick:is(:hover, [data-state='open']) {
  background: color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
  color: var(--color-base-foreground);
}
.mar-bo-status {
  display: flex;
  min-width: 0;
  align-items: flex-end;
  gap: 10px;
  margin-top: auto;
  padding-top: 12px;
  color: var(--color-muted-foreground);
  font-size: 12px;
  line-height: 16px;
}
.mar-bo-status > :last-child {
  flex-shrink: 0;
}
.mar-bo-menu-head {
  margin: 0;
  padding: 6px 12px 4px;
  color: var(--color-subtle-foreground);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.09em;
  line-height: 16px;
  text-transform: uppercase;
}
:root .proto-ui.proto-ui.proto-ui .mar-bo-option {
  height: auto;
  align-items: flex-start;
  padding-block: 6px;
}
:root .proto-ui.proto-ui.proto-ui .mar-bo-option.is-picked {
  background: var(--color-secondary-background);
}
.mar-bo-row {
  display: grid;
  min-height: 36px;
  grid-template-columns: 110px minmax(0, 1fr);
  align-items: center;
  gap: 16px;
}
.mar-bo-path {
  min-width: 0;
  overflow: hidden;
  margin-right: auto;
  padding-right: 12px;
  color: var(--color-base-foreground);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mar-bo-value {
  overflow: hidden;
  color: var(--color-base-foreground);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
