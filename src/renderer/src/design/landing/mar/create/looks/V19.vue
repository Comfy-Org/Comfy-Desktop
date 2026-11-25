<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ArrowRight, Check, Download, Package, Play, Plus, Search, X } from 'lucide-vue-next'
import WorkflowCover from '../../brand/WorkflowCover.vue'
import { fmtGb } from '../../templateModal/templateData'
import { allWorkflows } from '../../../gallery'
import { activeInstance } from '../../../useProto'
import { closeCreate, openTemplate, openWorkflow, startBlank } from '../createScreen'
import { readiness, searchStarters, SHELVES } from '../createStarters'
import {
  costLine,
  isKitReady,
  KITS,
  kitStatus,
  reducedMotion,
  useCloseOnEsc,
  type Kit
} from './lookD'

const installed = reactive(new Set<string>())
const progress = reactive<Record<string, number>>({})
const timers = new Map<string, number>()

const query = ref('')
const field = ref<HTMLInputElement>()
const q = computed(() => query.value.trim().toLowerCase())

const kits = computed(() =>
  KITS.filter(
    (k) =>
      !q.value ||
      `${k.name} ${k.promise} ${k.steps.map((s) => s.does).join(' ')}`
        .toLowerCase()
        .includes(q.value)
  ).map((kit) => ({ kit, status: kitStatus(kit, installed) }))
)
const open = ref<string | undefined>(KITS[0]!.id)
watch(kits, (list) => {
  if (!list.some((k) => k.kit.id === open.value)) open.value = list[0]?.kit.id
})

const singles = computed(() =>
  q.value ? searchStarters(q.value, 6) : SHELVES[0]!.starters().slice(0, 6)
)
const recents = computed(() => {
  const list = [...allWorkflows.value].sort((a, b) => a.age - b.age)
  return (q.value ? list.filter((w) => w.name.toLowerCase().includes(q.value)) : list).slice(0, 4)
})

const isInstalling = (kit: Kit): boolean => progress[kit.id] !== undefined

function install(kit: Kit): void {
  const { starters } = kitStatus(kit, installed)
  const finish = (): void => {
    starters.forEach((s) => installed.add(s.id))
    delete progress[kit.id]
    timers.delete(kit.id)
  }
  if (reducedMotion()) return finish()
  progress[kit.id] = 0
  const id = window.setInterval(() => {
    const next = (progress[kit.id] ?? 0) + 4 + Math.random() * 6
    if (next >= 100) {
      window.clearInterval(id)
      finish()
    } else progress[kit.id] = next
  }, 120)
  timers.set(kit.id, id)
}
onBeforeUnmount(() => timers.forEach((id) => window.clearInterval(id)))

function primary(kit: Kit): void {
  const status = kitStatus(kit, installed)
  if (isInstalling(kit)) return
  if (status.ready === status.starters.length) openTemplate(status.starters[0]!.template)
  else install(kit)
}

function key(e: KeyboardEvent): void {
  const ids = kits.value.map((k) => k.kit.id)
  const i = ids.indexOf(open.value ?? '')
  if (e.key === 'ArrowDown') open.value = ids[Math.min(ids.length - 1, i + 1)]
  else if (e.key === 'ArrowUp') open.value = ids[Math.max(0, i - 1)]
  else if (e.key === 'Enter') {
    const k = KITS.find((x) => x.id === open.value)
    if (k) primary(k)
    else if (singles.value[0]) openTemplate(singles.value[0].template)
    else startBlank()
  } else if (e.key === 'Escape') {
    if (query.value) query.value = ''
    else closeCreate()
  } else return
  e.preventDefault()
}

useCloseOnEsc(field)
</script>

<template>
  <section class="v19" aria-label="Create">
    <button type="button" class="v19-close" aria-label="Close" title="Close" @click="closeCreate">
      <X :size="16" />
    </button>

    <div class="v19-wrap">
      <header class="v19-head">
        <h1 class="v19-title">Create a workflow</h1>
        <p class="v19-sub">
          Pick a kit for the whole job. It sets up every template you need and downloads the models
          once.
        </p>
        <div class="v19-bar">
          <label class="v19-field">
            <Search :size="16" class="shrink-0 text-subtle-foreground" />
            <input
              ref="field"
              v-model="query"
              type="text"
              placeholder="Search kits, templates and your workflows"
              aria-label="Search kits, templates and your workflows"
              @keydown="key"
            />
            <button
              v-if="query"
              type="button"
              class="v19-clear"
              aria-label="Clear search"
              @click="((query = ''), field?.focus())"
            >
              <X :size="13" />
            </button>
          </label>
          <button
            type="button"
            class="v19-ghost"
            :title="`Empty canvas on ${activeInstance.name}`"
            @click="startBlank"
          >
            <Plus :size="15" />Blank canvas
          </button>
        </div>
      </header>

      <div class="v19-kits">
        <article
          v-for="({ kit, status }, ki) in kits"
          :key="kit.id"
          class="v19-kit"
          :class="open === kit.id && 'is-open'"
          :style="{ '--wire': kit.wire, '--i': ki }"
        >
          <button
            type="button"
            class="v19-kit-head"
            :aria-expanded="open === kit.id"
            @click="open = open === kit.id ? undefined : kit.id"
          >
            <span class="v19-pipe" aria-hidden="true">
              <template v-for="(s, i) in status.starters" :key="s.id">
                <i v-if="i" class="v19-pipe-wire" />
                <img :src="s.poster" alt="" loading="lazy" />
              </template>
            </span>
            <span class="v19-kit-text">
              <span class="v19-kit-name">{{ kit.name }}</span>
              <span class="v19-kit-promise">{{ kit.promise }}</span>
            </span>
            <span class="v19-kit-meter">
              <span
                class="v19-segs"
                :aria-label="`${status.ready} of ${status.starters.length} installed`"
              >
                <i
                  v-for="s in status.starters"
                  :key="s.id"
                  :class="isKitReady(s, installed) && 'is-in'"
                  :style="
                    isInstalling(kit) && !isKitReady(s, installed)
                      ? { '--fill': `${progress[kit.id]}%` }
                      : undefined
                  "
                />
              </span>
              <span class="v19-kit-count">
                <template v-if="isInstalling(kit)"
                  >Installing, {{ Math.round(progress[kit.id]!) }}%</template
                >
                <template v-else-if="status.ready === status.starters.length"
                  >All {{ status.ready }} installed</template
                >
                <template v-else
                  >{{ status.ready }} of {{ status.starters.length }} installed</template
                >
              </span>
            </span>
          </button>

          <div v-if="open === kit.id" class="v19-detail">
            <ol class="v19-steps">
              <li v-for="(s, i) in status.starters" :key="s.id" class="v19-step">
                <button type="button" class="v19-step-btn" @click="openTemplate(s.template)">
                  <span class="v19-step-n">{{ i + 1 }}</span>
                  <img :src="s.poster" alt="" loading="lazy" class="v19-step-pic" />
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span class="v19-step-name">{{ s.makes }}</span>
                    <span class="v19-step-model">{{ s.model }}</span>
                  </span>
                  <span class="v19-step-state" :class="isKitReady(s, installed) && 'is-in'">
                    <template v-if="isKitReady(s, installed)"
                      ><Check :size="13" />Installed</template
                    >
                    <template v-else>{{ readiness(s.template).label }}</template>
                  </span>
                </button>
              </li>
            </ol>
            <div class="v19-cta">
              <div class="min-w-0 flex-1">
                <p v-if="status.downloadGb" class="v19-gb">
                  <b>{{ fmtGb(status.downloadGb) }}</b> to download for the whole kit
                </p>
                <p v-else class="v19-gb"><b>Nothing to download.</b> Every step is ready.</p>
                <p class="v19-note">
                  <template v-if="status.sharedGb > 0.05"
                    >{{ fmtGb(status.sharedGb) }} less than one at a time, because steps share
                    models.
                  </template>
                  {{ costLine(status.starters[0]!.template) }}.
                </p>
              </div>
              <button
                type="button"
                class="v19-go"
                :disabled="isInstalling(kit)"
                @click="primary(kit)"
              >
                <template v-if="isInstalling(kit)">Installing…</template>
                <template v-else-if="status.ready === status.starters.length">
                  <Play :size="15" />Start with {{ status.starters[0]!.makes.toLowerCase() }}
                </template>
                <template v-else><Download :size="15" />Install kit</template>
              </button>
            </div>
          </div>
        </article>
        <p v-if="!kits.length" class="v19-none">
          No kit matches “{{ query.trim() }}”. Try a single template below.
        </p>
      </div>

      <section v-if="singles.length" class="v19-more">
        <h2 class="v19-h2"><Package :size="15" />Or one template at a time</h2>
        <div class="v19-singles">
          <button
            v-for="s in singles"
            :key="s.id"
            type="button"
            class="v19-single"
            @click="openTemplate(s.template)"
          >
            <span class="v19-single-pic"><img :src="s.poster" alt="" loading="lazy" /></span>
            <span class="v19-step-name">{{ s.makes }}</span>
            <span class="v19-step-model">{{ s.model }}</span>
          </button>
        </div>
      </section>

      <section v-if="recents.length" class="v19-more">
        <h2 class="v19-h2">Your recent workflows</h2>
        <div class="v19-recents">
          <button
            v-for="w in recents"
            :key="w.id"
            type="button"
            class="v19-wf"
            @click="openWorkflow(w)"
          >
            <span class="v19-wf-cover"><WorkflowCover :name="w.name" /></span>
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="v19-step-name">{{ w.name }}</span>
              <span class="v19-step-model">{{ w.modified }}</span>
            </span>
            <ArrowRight :size="14" class="shrink-0 text-subtle-foreground" />
          </button>
        </div>
      </section>
    </div>
  </section>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .v19 {
  position: relative;
  min-height: 100%;
  padding: 0 32px 72px;
}
:root .proto-ui.proto-ui.proto-ui .v19-close {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 2;
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 8px;
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v19-close:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v19-wrap {
  max-width: 1040px;
  margin: 0 auto;
}
:root .proto-ui.proto-ui.proto-ui .v19-head {
  padding-top: 56px;
}
:root .proto-ui.proto-ui.proto-ui .v19-title {
  color: var(--color-base-foreground);
  font-size: var(--text-display);
  font-weight: 700;
  line-height: var(--text-display--line-height);
  letter-spacing: -0.02em;
}
:root .proto-ui.proto-ui.proto-ui .v19-sub {
  max-width: 60ch;
  margin-top: 8px;
  color: var(--color-muted-foreground);
  font-size: 15px;
  line-height: 22px;
}
:root .proto-ui.proto-ui.proto-ui .v19-bar {
  display: flex;
  gap: 8px;
  margin-top: 24px;
}
:root .proto-ui.proto-ui.proto-ui .v19-field {
  display: flex;
  height: 44px;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 10px;
  padding: 0 10px 0 14px;
  border-radius: 12px;
  background: var(--color-secondary-background);
  box-shadow: inset 0 0 0 1px transparent;
}
:root .proto-ui.proto-ui.proto-ui .v19-field:focus-within {
  box-shadow: inset 0 0 0 1px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v19-field input {
  height: auto;
  min-width: 0;
  flex: 1;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  box-shadow: none;
  color: var(--color-base-foreground);
  font: inherit;
  font-size: 14px;
}
:root .proto-ui.proto-ui.proto-ui .v19-field input::placeholder {
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v19-clear {
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border-radius: 6px;
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v19-ghost {
  display: inline-flex;
  height: 44px;
  align-items: center;
  gap: 7px;
  padding: 0 16px;
  border-radius: 12px;
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
  box-shadow: inset 0 0 0 1px var(--color-border-default);
}
:root .proto-ui.proto-ui.proto-ui .v19-ghost:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v19-kits {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 32px;
}
:root .proto-ui.proto-ui.proto-ui .v19-kit {
  overflow: hidden;
  border-radius: 18px;
  background: var(--color-card-background);
  box-shadow: inset 0 0 0 1px var(--color-border-default);
  animation: v19-rise 420ms var(--mar-ease, ease-out) both;
  animation-delay: calc(var(--i) * 50ms);
  transition: box-shadow 200ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v19-kit.is-open {
  box-shadow:
    inset 0 0 0 1px color-mix(in oklch, var(--wire) 45%, transparent),
    0 24px 48px -28px color-mix(in oklch, var(--wire) 40%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .v19-kit-head {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 24px;
  padding: 14px 22px 14px 14px;
  text-align: left;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .v19-kit-head:focus-visible {
  box-shadow: inset 0 0 0 2px var(--color-border-focus);
  border-radius: 18px;
}
:root .proto-ui.proto-ui.proto-ui .v19-pipe {
  display: flex;
  width: 252px;
  flex: none;
  align-items: center;
}
:root .proto-ui.proto-ui.proto-ui .v19-pipe img {
  width: 72px;
  height: 72px;
  border-radius: 12px;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v19-pipe-wire {
  position: relative;
  width: 18px;
  height: 3px;
  border-radius: 2px;
  background: var(--wire);
}
:root .proto-ui.proto-ui.proto-ui .v19-pipe-wire::before,
:root .proto-ui.proto-ui.proto-ui .v19-pipe-wire::after {
  content: '';
  position: absolute;
  top: -2.5px;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--wire);
}
:root .proto-ui.proto-ui.proto-ui .v19-pipe-wire::before {
  left: -4px;
}
:root .proto-ui.proto-ui.proto-ui .v19-pipe-wire::after {
  right: -4px;
}
:root .proto-ui.proto-ui.proto-ui .v19-kit-text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}
:root .proto-ui.proto-ui.proto-ui .v19-kit-name {
  color: var(--color-base-foreground);
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
:root .proto-ui.proto-ui.proto-ui .v19-kit-promise {
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v19-kit-meter {
  display: flex;
  width: 150px;
  flex: none;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}
:root .proto-ui.proto-ui.proto-ui .v19-segs {
  display: flex;
  width: 100%;
  gap: 4px;
}
:root .proto-ui.proto-ui.proto-ui .v19-segs i {
  --fill: 0%;
  height: 6px;
  flex: 1;
  border-radius: 999px;
  background: linear-gradient(
    to right,
    var(--wire) var(--fill),
    var(--color-secondary-background-hover) var(--fill)
  );
}
:root .proto-ui.proto-ui.proto-ui .v19-segs i.is-in {
  background: var(--wire);
}
:root .proto-ui.proto-ui.proto-ui .v19-kit-count {
  color: var(--color-subtle-foreground);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
:root .proto-ui.proto-ui.proto-ui .v19-detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 4px 22px 20px;
  animation: v19-open 260ms var(--mar-ease, ease-out) both;
}
:root .proto-ui.proto-ui.proto-ui .v19-steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding-top: 14px;
  border-top: 1px solid var(--color-border-default);
}
:root .proto-ui.proto-ui.proto-ui .v19-step-btn {
  display: flex;
  width: 100%;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: 12px;
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .v19-step-btn:hover {
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .v19-step-n {
  display: grid;
  width: 22px;
  height: 22px;
  flex: none;
  place-items: center;
  border-radius: 999px;
  background: color-mix(in oklch, var(--wire) 22%, transparent);
  color: var(--color-base-foreground);
  font-size: 11px;
  font-weight: 700;
}
:root .proto-ui.proto-ui.proto-ui .v19-step-pic {
  width: 44px;
  height: 44px;
  flex: none;
  border-radius: 8px;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v19-step-name {
  overflow: hidden;
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .v19-step-model {
  overflow: hidden;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .v19-step-state {
  display: inline-flex;
  width: 100%;
  align-items: center;
  gap: 5px;
  padding-left: 32px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v19-step-state.is-in {
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v19-step-state.is-in svg {
  color: var(--color-status-running);
}
:root .proto-ui.proto-ui.proto-ui .v19-cta {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 14px 16px;
  border-radius: 14px;
  background: color-mix(in oklch, var(--wire) 9%, var(--color-secondary-background));
}
:root .proto-ui.proto-ui.proto-ui .v19-gb {
  color: var(--color-muted-foreground);
  font-size: 14px;
}
:root .proto-ui.proto-ui.proto-ui .v19-gb b {
  color: var(--color-base-foreground);
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v19-note {
  margin-top: 2px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v19-go {
  display: inline-flex;
  height: 42px;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 0 18px;
  border-radius: 11px;
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
  font-size: 14px;
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v19-go:hover {
  background: var(--color-inverted-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .v19-go:disabled {
  opacity: 0.6;
}
:root .proto-ui.proto-ui.proto-ui .v19-none {
  padding: 12px 4px;
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v19-more {
  margin-top: 40px;
}
:root .proto-ui.proto-ui.proto-ui .v19-h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  color: var(--color-base-foreground);
  font-size: var(--text-heading);
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v19-singles {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v19-single {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .v19-single-pic {
  aspect-ratio: 1;
  margin-bottom: 6px;
  overflow: hidden;
  border-radius: 12px;
  background: var(--color-card-background);
}
:root .proto-ui.proto-ui.proto-ui .v19-single-pic img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 400ms var(--mar-ease, ease-out);
}
:root .proto-ui.proto-ui.proto-ui .v19-single:hover img {
  transform: scale(1.04);
}
:root .proto-ui.proto-ui.proto-ui .v19-recents {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 16px;
}
:root .proto-ui.proto-ui.proto-ui .v19-wf {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
  padding: 8px;
  border-radius: 12px;
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .v19-wf:hover {
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .v19-wf-cover {
  position: relative;
  width: 56px;
  height: 40px;
  flex: none;
  overflow: hidden;
  border-radius: 8px;
}
@keyframes v19-rise {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
@keyframes v19-open {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
}
@media (max-width: 900px) {
  :root .proto-ui.proto-ui.proto-ui .v19-steps {
    grid-template-columns: 1fr;
  }
  :root .proto-ui.proto-ui.proto-ui .v19-singles {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  :root .proto-ui.proto-ui.proto-ui .v19-pipe img {
    width: 52px;
    height: 52px;
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v19-kit,
  :root .proto-ui.proto-ui.proto-ui .v19-detail {
    animation: none;
  }
  :root .proto-ui.proto-ui.proto-ui .v19-single-pic img {
    transition: none;
  }
}
</style>
