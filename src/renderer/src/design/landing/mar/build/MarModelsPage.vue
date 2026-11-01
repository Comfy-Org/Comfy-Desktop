<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  ChevronDown,
  Cloud,
  Download,
  KeyRound,
  LayoutGrid,
  List,
  Plus,
  SquareCheck,
  Star,
  Trash2,
  TriangleAlert,
  X
} from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import EmptyState from '../../ui/EmptyState.vue'
import SearchInput from '../../ui/SearchInput.vue'
import Select from '../../ui/Select.vue'
import { ROUTER_MODELS } from '../../mock'
import { go, toast } from '../../useProto'
import { ComfyModel } from '../icons/comfyIcons'
import ModelDeleteDialog from './ModelDeleteDialog.vue'
import ModelDetail from './ModelDetail.vue'
import ModelImportDialog from './ModelImportDialog.vue'
import ModelStatus from './ModelStatus.vue'
import ModelTile from './ModelTile.vue'
import {
  activeDownloads,
  diskTotalGb,
  downloadOf,
  fmtSize,
  freeGb,
  installed,
  MODEL_BUILDS,
  MODELS_FOLDER,
  missingFor,
  modelById,
  modelsApi,
  modelsState,
  SOURCE_LABEL,
  TYPE_LABEL,
  unused,
  usedByType,
  usedGb,
  WORKFLOW_NEEDS,
  type Model,
  type ModelSource,
  type ModelType
} from './models'

/**
 * Build > Models in Mar's proposal: every model on this computer, what's
 * available to download, the download queue, and the partner models the
 * API calls without downloading anything. Layout after Willie Falloon's
 * Assets library (rail with scopes and facet counts, sort, density,
 * Select); the info panel after the frontend's ModelInfoPanel.
 */
type Scope =
  | 'all'
  | 'installed'
  | 'available'
  | 'downloads'
  | 'favorites'
  | 'missing'
  | 'unused'
  | 'partner'
const scope = ref<Scope>('installed')
const q = ref('')
const facet = ref<{
  type?: ModelType
  base?: string
  source?: ModelSource
  build?: string
}>({})
const sort = ref<'recent' | 'name' | 'size'>('size')
const view = ref<'list' | 'grid'>('list')
const VIEWS = [
  { value: 'list' as const, label: 'List', icon: List },
  { value: 'grid' as const, label: 'Grid', icon: LayoutGrid }
]
const selecting = ref(false)
const picked = ref<string[]>([])
const openId = ref<string>('')
const importing = ref(false)
const deleting = ref<string[]>([])
const open = ref<Record<string, boolean>>({ type: true, base: true, source: false, build: false })

const need = WORKFLOW_NEEDS[0]!
const missing = computed(() => missingFor(need))
const missingGb = computed(() => missing.value.reduce((n, x) => n + x.sizeGb, 0))
const unusedGb = computed(() => unused.value.reduce((n, x) => n + x.sizeGb, 0))

const inScope = computed<Model[]>(() => {
  const all = modelsState.models
  switch (scope.value) {
    case 'installed':
      return installed.value
    case 'available':
      return all.filter((x) => !x.installed)
    case 'downloads':
      return modelsState.downloads.map((d) => modelById(d.modelId)).filter((x): x is Model => !!x)
    case 'favorites':
      return all.filter((x) => modelsState.favorites.includes(x.id))
    case 'missing':
      return missing.value
    case 'unused':
      return unused.value
    default:
      return all
  }
})
const matchesQuery = (x: Model): boolean =>
  `${x.name} ${x.file} ${x.base} ${x.author} ${TYPE_LABEL[x.type]}`
    .toLowerCase()
    .includes(q.value.trim().toLowerCase())
const searched = computed(() => inScope.value.filter(matchesQuery))
const list = computed(() => {
  const f = facet.value
  const out = searched.value.filter(
    (x) =>
      (!f.type || x.type === f.type) &&
      (!f.base || x.base === f.base) &&
      (!f.source || x.source === f.source) &&
      (!f.build || x.usedBy.includes(f.build))
  )
  if (scope.value === 'downloads') return out
  return [...out].sort((a, b) =>
    sort.value === 'name'
      ? a.name.localeCompare(b.name)
      : sort.value === 'size'
        ? b.sizeGb - a.sizeGb
        : Number(b.installed) - Number(a.installed) || a.name.localeCompare(b.name)
  )
})
const finished = computed(() =>
  scope.value === 'downloads'
    ? modelsState.finished.map(modelById).filter((x): x is Model => !!x && matchesQuery(x))
    : []
)

/** Facet counts follow the scope and the search, like Willie's rail. */
function counts<K extends string>(key: (x: Model) => K | K[]): [K, number][] {
  const map = new Map<K, number>()
  for (const x of searched.value)
    for (const k of ([] as K[]).concat(key(x))) map.set(k, (map.get(k) ?? 0) + 1)
  return [...map.entries()].sort((a, b) => b[1] - a[1])
}
const FACETS = computed(() => [
  {
    key: 'type' as const,
    title: 'Type',
    rows: counts((x) => x.type).map(([k, n]) => ({ value: k, label: TYPE_LABEL[k], n }))
  },
  {
    key: 'base' as const,
    title: 'Base model',
    rows: counts((x) => x.base).map(([k, n]) => ({ value: k, label: k, n }))
  },
  {
    key: 'source' as const,
    title: 'Source',
    rows: counts((x) => x.source).map(([k, n]) => ({ value: k, label: SOURCE_LABEL[k], n }))
  },
  {
    key: 'build' as const,
    title: 'Used by',
    rows: counts((x) => x.usedBy).map(([k, n]) => ({ value: k, label: MODEL_BUILDS[k] ?? k, n }))
  }
])
function pickFacet(key: keyof typeof facet.value, value: string): void {
  facet.value = { ...facet.value, [key]: facet.value[key] === value ? undefined : value }
}
const chips = computed(() =>
  (Object.entries(facet.value) as [keyof typeof facet.value, string | undefined][])
    .filter(([, v]) => v)
    .map(([k, v]) => ({
      key: k,
      label:
        k === 'type'
          ? TYPE_LABEL[v as ModelType]
          : k === 'source'
            ? SOURCE_LABEL[v as ModelSource]
            : k === 'build'
              ? `Used by ${MODEL_BUILDS[v!] ?? v}`
              : v!
    }))
)

const SCOPES = computed(() => [
  { value: 'installed' as const, label: 'On this computer', n: installed.value.length },
  {
    value: 'available' as const,
    label: 'Available',
    n: modelsState.models.filter((x) => !x.installed).length
  },
  { value: 'downloads' as const, label: 'Downloads', n: modelsState.downloads.length },
  { value: 'favorites' as const, label: 'Favorites', n: modelsState.favorites.length },
  { value: 'partner' as const, label: 'Partner API', n: ROUTER_MODELS.length }
])

watch(scope, () => {
  picked.value = []
  selecting.value = false
})
const openModel = computed(() => (openId.value ? modelById(openId.value) : undefined))
const pickedModels = computed(() => picked.value.map(modelById).filter((x): x is Model => !!x))

function toggle(id: string): void {
  const i = picked.value.indexOf(id)
  if (i >= 0) picked.value.splice(i, 1)
  else picked.value.push(id)
}
function rowClick(x: Model): void {
  if (selecting.value) toggle(x.id)
  else openId.value = openId.value === x.id ? '' : x.id
}
function downloadAll(ids: string[], forBuild?: string): void {
  let n = 0
  for (const id of ids) if (modelsApi.download(id, forBuild)) n++
  if (n < ids.length) toast('Not enough space for all of them')
  else toast(`Downloading ${n} model${n === 1 ? '' : 's'}`)
}
function onDeleted(): void {
  picked.value = []
  selecting.value = false
  if (openId.value && !modelById(openId.value)?.installed && scope.value === 'installed')
    openId.value = ''
}

const DISK_COLORS: Partial<Record<ModelType, number>> = {
  diffusion: 250,
  checkpoint: 20,
  'text-encoder': 160,
  lora: 60,
  vae: 300,
  upscaler: 200,
  controlnet: 110
}
const diskBars = computed(() =>
  (Object.entries(usedByType.value) as [ModelType, number][])
    .sort((a, b) => b[1] - a[1])
    .map(([t, gb]) => ({ t, gb, pct: (gb / diskTotalGb) * 100, h: DISK_COLORS[t] ?? 0 }))
)
const lowDisk = computed(() => freeGb.value < 120)
</script>

<template>
  <div class="mm-page mx-auto w-full px-8 pt-8 pb-16">
    <!-- Rail: scopes, facets with counts, and where the files live. -->
    <nav class="mm-rail" aria-label="Models">
      <div><SearchInput v-model="q" placeholder="Search models" class="w-full" /></div>
      <ul class="mt-3 flex flex-col gap-px">
        <li v-for="s in SCOPES" :key="s.value">
          <button
            class="mm-rail-row"
            :class="{ 'is-on': scope === s.value }"
            :aria-current="scope === s.value ? 'page' : undefined"
            @click="scope = s.value"
          >
            <Star v-if="s.value === 'favorites'" :size="13" class="text-subtle-foreground" />
            <Cloud v-else-if="s.value === 'partner'" :size="13" class="text-subtle-foreground" />
            <span class="flex-1 truncate">{{ s.label }}</span>
            <span
              v-if="
                s.value === 'downloads' && activeDownloads.some((d) => d.state === 'downloading')
              "
              class="mm-live"
            />
            <span class="mm-n">{{ s.n }}</span>
          </button>
        </li>
      </ul>

      <template v-if="scope !== 'partner'">
        <div v-for="f in FACETS" :key="f.key" class="mm-facet">
          <button
            class="mm-facet-head"
            :aria-expanded="open[f.key]"
            @click="open[f.key] = !open[f.key]"
          >
            <ChevronDown :size="13" :class="{ '-rotate-90': !open[f.key] }" class="transition" />
            <span class="flex-1">{{ f.title }}</span>
            <span class="mm-n">{{ f.rows.length }}</span>
          </button>
          <ul v-if="open[f.key]" class="flex flex-col gap-px">
            <li v-if="!f.rows.length" class="px-7 py-1 text-ui text-subtle-foreground">None</li>
            <li v-for="r in f.rows" :key="r.value">
              <button
                class="mm-rail-row is-sub"
                :class="{ 'is-on': facet[f.key] === r.value }"
                :aria-pressed="facet[f.key] === r.value"
                @click="pickFacet(f.key, r.value)"
              >
                <span class="flex-1 truncate">{{ r.label }}</span>
                <span class="mm-n">{{ r.n }}</span>
              </button>
            </li>
          </ul>
        </div>
      </template>

      <div class="mm-disk">
        <div class="flex items-baseline justify-between">
          <span class="mm-h">Disk</span>
          <span class="text-[11px] text-subtle-foreground tabular-nums"
            >{{ fmtSize(freeGb) }} free</span
          >
        </div>
        <div class="mm-disk-bar" :title="`Models use ${fmtSize(usedGb)} of ${diskTotalGb} GB`">
          <i
            v-for="b in diskBars"
            :key="b.t"
            :style="{ width: `${b.pct}%`, '--h': b.h }"
            :title="`${TYPE_LABEL[b.t]}: ${fmtSize(b.gb)}`"
          />
          <i
            class="is-other"
            :style="{ width: `${(641 / diskTotalGb) * 100}%` }"
            title="Everything else"
          />
        </div>
        <p class="mt-1.5 text-[11px] text-subtle-foreground">
          Models use <b class="font-medium text-muted-foreground">{{ fmtSize(usedGb) }}</b>
        </p>
        <p class="mm-h mt-3">Saved to</p>
        <p class="mt-1 truncate font-mono text-[11px] text-muted-foreground" :title="MODELS_FOLDER">
          {{ MODELS_FOLDER }}
        </p>
        <button class="mm-change" @click="toast('Pick another folder')">Change…</button>
      </div>
    </nav>

    <main class="min-w-0">
      <header class="mm-head flex items-end justify-between gap-4 pb-5">
        <div class="min-w-0">
          <h1 class="mm-title">Models</h1>
        </div>
        <!-- Pablo keeps provider keys in admin; they belong next to the
             models they unlock. -->
        <Button v-if="scope === 'partner'" size="sm" variant="subtle" @click="go('provider-keys')"
          ><KeyRound :size="13" />Provider keys</Button
        >
        <div v-else class="flex items-center gap-2">
          <Select
            v-model="sort"
            label="Sort"
            :options="[
              { value: 'size', label: 'Largest' },
              { value: 'name', label: 'Name' },
              { value: 'recent', label: 'On disk first' }
            ]"
            class="w-40"
          />
          <div class="mm-view" role="radiogroup" aria-label="View">
            <button
              v-for="v in VIEWS"
              :key="v.value"
              type="button"
              role="radio"
              class="mm-view-btn"
              :aria-checked="view === v.value"
              :aria-label="v.label"
              :title="v.label"
              @click="view = v.value"
            >
              <component :is="v.icon" :size="14" />
            </button>
          </div>
          <Button
            :variant="selecting ? 'subtle' : 'secondary'"
            :aria-pressed="selecting"
            @click="((selecting = !selecting), (picked = []))"
            ><SquareCheck :size="14" />Select</Button
          >
          <Button variant="primary" @click="importing = true"><Plus :size="14" />From link</Button>
        </div>
      </header>

      <!-- What needs you: a workflow that can't run, then a full disk. -->
      <div v-if="missing.length && !['partner', 'downloads'].includes(scope)" class="mm-alert">
        <TriangleAlert :size="16" class="mm-alert-icon" />
        <div class="min-w-0 flex-1">
          <p class="font-medium">
            {{ need.workflow }} is missing {{ missing.length }} model{{
              missing.length === 1 ? '' : 's'
            }}
          </p>
          <p class="mt-0.5 text-muted-foreground">
            {{ missing.map((x) => x.name).join(', ') }} · {{ fmtSize(missingGb) }} · in
            {{ MODEL_BUILDS[need.build] }}
          </p>
        </div>
        <Button v-if="scope !== 'missing'" size="sm" variant="ghost" @click="scope = 'missing'"
          >Review</Button
        >
        <Button
          v-if="missing.some((x) => !downloadOf(x.id))"
          size="sm"
          variant="primary"
          @click="
            downloadAll(
              missing.filter((x) => !downloadOf(x.id)).map((x) => x.id),
              need.build
            )
          "
          ><Download :size="13" />Download all</Button
        >
      </div>
      <div v-else-if="scope === 'missing' && !missing.length" class="mm-alert is-ok">
        <p class="flex-1">{{ need.workflow }} has every model it needs.</p>
        <Button size="sm" variant="ghost" @click="scope = 'installed'">Done</Button>
      </div>
      <div v-if="lowDisk && scope !== 'partner'" class="mm-alert">
        <TriangleAlert :size="16" class="mm-alert-icon" />
        <p class="flex-1">
          Only {{ fmtSize(freeGb) }} left on this disk.
          <template v-if="unused.length"
            >{{ unused.length }} models nothing uses take {{ fmtSize(unusedGb) }}.</template
          >
        </p>
        <Button v-if="unused.length" size="sm" variant="ghost" @click="scope = 'unused'"
          >Review</Button
        >
      </div>

      <div v-if="chips.length" class="mb-3 flex flex-wrap items-center gap-1.5">
        <button
          v-for="c in chips"
          :key="c.key"
          class="mm-filter-chip"
          @click="facet = { ...facet, [c.key]: undefined }"
        >
          {{ c.label }}<X :size="12" />
        </button>
        <Button size="sm" variant="link" class="ml-1" @click="facet = {}">Clear</Button>
      </div>

      <div v-if="selecting" class="mm-selbar">
        <span class="flex-1 text-ui">{{ picked.length }} selected</span>
        <Button size="sm" variant="ghost" @click="picked = list.map((x) => x.id)"
          >Select all</Button
        >
        <Button
          v-if="pickedModels.some((x) => !x.installed)"
          size="sm"
          :disabled="!picked.length"
          @click="downloadAll(pickedModels.filter((x) => !x.installed).map((x) => x.id))"
          ><Download :size="13" />Download</Button
        >
        <Button
          size="sm"
          variant="destructive"
          :disabled="!pickedModels.some((x) => x.installed)"
          @click="deleting = pickedModels.filter((x) => x.installed).map((x) => x.id)"
          ><Trash2 :size="13" />Delete</Button
        >
      </div>

      <!-- Partner models: Pablo's Router list, kept. -->
      <div v-if="scope === 'partner'" class="mm-list mar-surface">
        <div v-for="r in ROUTER_MODELS" :key="r.model" class="mm-row is-partner">
          <span class="mm-partner-mark"><ComfyModel :size="16" /></span>
          <span class="min-w-0">
            <span class="block truncate font-medium">{{ r.model }}</span>
            <span class="block text-[12px] text-subtle-foreground">{{ r.provider }}</span>
          </span>
          <span class="text-ui text-muted-foreground">{{ r.kind }}</span>
          <span class="text-right text-ui text-subtle-foreground tabular-nums">{{ r.price }}</span>
        </div>
      </div>

      <template v-else>
        <EmptyState
          v-if="!list.length && !finished.length"
          :icon="scope === 'downloads' ? Download : ComfyModel"
          :title="
            q || chips.length
              ? 'No models match'
              : scope === 'downloads'
                ? 'Nothing downloading'
                : scope === 'favorites'
                  ? 'No favorites yet'
                  : 'Nothing here'
          "
          :description="
            q || chips.length
              ? 'Try another word, or clear the filters.'
              : scope === 'downloads'
                ? 'Downloads you start show their progress here, and keep going while you work.'
                : scope === 'favorites'
                  ? 'Star a model to keep it at hand.'
                  : 'Browse what you can download.'
          "
          class="mt-6"
        />

        <div v-else-if="view === 'list'" class="flex flex-col gap-4">
          <div
            v-if="list.length"
            class="mm-list mar-surface"
            :class="{ 'is-selecting': selecting }"
          >
            <div
              v-for="x in list"
              :key="x.id"
              class="mm-row"
              :class="{ 'is-open': openId === x.id, 'is-picked': picked.includes(x.id) }"
              role="button"
              tabindex="0"
              :aria-pressed="selecting ? picked.includes(x.id) : undefined"
              @click="rowClick(x)"
              @keydown.enter="rowClick(x)"
            >
              <span class="relative">
                <ModelTile :model="x" />
                <span
                  v-if="selecting"
                  class="mm-check"
                  :class="{ 'is-on': picked.includes(x.id) }"
                />
              </span>
              <span class="min-w-0">
                <span class="flex items-center gap-1.5">
                  <span class="truncate font-medium">{{ x.name }}</span>
                  <Star
                    v-if="modelsState.favorites.includes(x.id)"
                    :size="11"
                    class="mm-fav shrink-0"
                  />
                </span>
                <span class="block truncate font-mono text-[11px] text-subtle-foreground">{{
                  x.file
                }}</span>
              </span>
              <span class="mm-cell">{{ TYPE_LABEL[x.type] }}</span>
              <span class="mm-cell">{{ x.base }}</span>
              <span class="mm-cell is-num">{{ fmtSize(x.sizeGb) }}</span>
              <span class="mm-cell truncate">
                {{
                  x.usedBy.length
                    ? x.usedBy.length === 1
                      ? MODEL_BUILDS[x.usedBy[0]!]
                      : `${x.usedBy.length} builds`
                    : x.installed
                      ? 'Unused'
                      : SOURCE_LABEL[x.source]
                }}
              </span>
              <ModelStatus :model="x" />
            </div>
          </div>
          <section v-if="finished.length">
            <h2 class="mm-h mb-2 px-1">Finished</h2>
            <div class="mm-list mar-surface">
              <div
                v-for="x in finished"
                :key="x.id"
                class="mm-row"
                role="button"
                tabindex="0"
                @click="openId = x.id"
                @keydown.enter="openId = x.id"
              >
                <ModelTile :model="x" />
                <span class="min-w-0">
                  <span class="block truncate font-medium">{{ x.name }}</span>
                  <span class="block truncate font-mono text-[11px] text-subtle-foreground">{{
                    x.file
                  }}</span>
                </span>
                <span class="mm-cell">{{ TYPE_LABEL[x.type] }}</span>
                <span class="mm-cell">{{ x.base }}</span>
                <span class="mm-cell is-num">{{ fmtSize(x.sizeGb) }}</span>
                <span class="mm-cell">{{ x.addedAt }}</span>
                <ModelStatus :model="x" />
              </div>
            </div>
          </section>
        </div>

        <div v-else class="mm-grid">
          <div
            v-for="x in [...list, ...finished]"
            :key="x.id"
            class="mm-card mar-surface"
            :class="{ 'is-open': openId === x.id, 'is-picked': picked.includes(x.id) }"
            role="button"
            tabindex="0"
            @click="rowClick(x)"
            @keydown.enter="rowClick(x)"
          >
            <div class="flex items-start justify-between">
              <ModelTile :model="x" :size="44" />
              <span
                v-if="selecting"
                class="mm-check is-static"
                :class="{ 'is-on': picked.includes(x.id) }"
              />
              <Star v-else-if="modelsState.favorites.includes(x.id)" :size="13" class="mm-fav" />
            </div>
            <p class="mt-3 truncate font-medium">{{ x.name }}</p>
            <p class="mt-0.5 truncate text-[12px] text-subtle-foreground">
              {{ TYPE_LABEL[x.type] }} · {{ x.base }} · {{ fmtSize(x.sizeGb) }}
            </p>
            <div class="mt-3"><ModelStatus :model="x" wide /></div>
          </div>
        </div>
      </template>
    </main>

    <ModelDetail
      v-if="openModel && scope !== 'partner'"
      :key="openModel.id"
      :model="openModel"
      class="mm-side"
      @close="openId = ''"
      @delete="(id) => (deleting = [id])"
    />

    <ModelImportDialog v-model="importing" @added="scope = 'downloads'" />
    <ModelDeleteDialog v-model="deleting" @deleted="onDeleted" />
  </div>
</template>

<style scoped>
.mm-page {
  display: grid;
  max-width: 1440px;
  grid-template-columns: 216px minmax(0, 1fr);
  align-items: start;
  gap: 28px;
}
.mm-page:has(.mm-side) {
  grid-template-columns: 216px minmax(0, 1fr) 320px;
}
.mm-rail {
  position: sticky;
  top: 16px;
  display: flex;
  flex-direction: column;
}
:root .proto-ui.proto-ui.proto-ui .mm-rail-row,
:root .proto-ui.proto-ui.proto-ui .mm-facet-head {
  display: flex;
  width: 100%;
  min-height: 30px;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-radius: 8px;
  color: var(--color-muted-foreground);
  font-size: 13px;
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .mm-rail-row:hover,
:root .proto-ui.proto-ui.proto-ui .mm-facet-head:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mm-rail-row.is-sub {
  padding-left: 30px;
}
:root .proto-ui.proto-ui.proto-ui .mm-rail-row.is-on {
  background: color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
  color: var(--color-base-foreground);
  font-weight: 500;
}
.mm-facet {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--color-border-default);
}
.mm-facet + .mm-facet {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 0;
}
:root .proto-ui.proto-ui.proto-ui .mm-facet-head {
  color: var(--color-base-foreground);
  font-weight: 500;
}
.mm-n {
  color: var(--color-subtle-foreground);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.mm-live {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--color-status-running, #4ade80);
  animation: mm-pulse 1.4s ease-in-out infinite;
}
@keyframes mm-pulse {
  50% {
    opacity: 0.35;
  }
}
@media (prefers-reduced-motion: reduce) {
  .mm-live {
    animation: none;
  }
}
.mm-disk {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--color-border-default);
}
.mm-disk-bar {
  display: flex;
  height: 6px;
  margin-top: 8px;
  overflow: hidden;
  gap: 1px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
.mm-disk-bar i {
  display: block;
  height: 100%;
  background: oklch(0.68 0.13 var(--h));
}
.mm-disk-bar i.is-other {
  background: color-mix(in oklch, var(--color-base-foreground) 22%, transparent);
}
.mm-view {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: var(--mar-tab-radius);
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mm-view-btn {
  display: inline-flex;
  width: 30px;
  height: 28px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: var(--mar-tab-item-radius);
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mm-view-btn[aria-checked='true'] {
  background: color-mix(in oklch, var(--color-base-foreground) 11%, transparent);
  color: var(--color-base-foreground);
}
.mm-h {
  color: var(--color-subtle-foreground);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
:root .proto-ui.proto-ui.proto-ui .mm-change {
  margin-top: 4px;
  padding: 0;
  color: var(--color-muted-foreground);
  font-size: 11px;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.mm-title {
  font-size: 40px;
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 1.1;
}
.mm-alert {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  background: color-mix(in oklch, var(--color-status-warning, #f5b14c) 11%, transparent);
  font-size: 13px;
}
.mm-alert.is-ok {
  background: color-mix(in oklch, var(--color-status-running, #4ade80) 11%, transparent);
}
.mm-alert-icon {
  flex-shrink: 0;
  color: var(--color-status-warning, #f5b14c);
}
:root .proto-ui.proto-ui.proto-ui .mm-filter-chip {
  display: inline-flex;
  height: 26px;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border-radius: var(--radius-control);
  background: color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
  font-size: 12px;
}
.mm-selbar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  padding: 6px 6px 6px 14px;
  border-radius: 12px;
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
}
.mm-list {
  overflow: hidden;
  padding: 4px;
  border-radius: 16px;
}
/* Rows follow the one table pattern (../table/table.css): 48px,
   full-width hairlines that a filled row hides, sizes right-aligned in tabular
   figures. */
.mm-row {
  position: relative;
  display: grid;
  min-height: 48px;
  grid-template-columns: 36px minmax(0, 1.6fr) 120px 100px 72px minmax(0, 0.8fr) 220px;
  align-items: center;
  column-gap: 16px;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  transition: background-color 120ms ease;
}
.mm-row + .mm-row::before {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 1px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  content: '';
  pointer-events: none;
}
.mm-row:is(:hover, :focus-visible, .is-open, .is-picked)::before,
.mm-row:is(:hover, :focus-visible, .is-open, .is-picked) + .mm-row::before {
  opacity: 0;
}
.mm-row.is-partner:hover::before,
.mm-row.is-partner:hover + .mm-row::before {
  opacity: 1;
}
.mm-cell.is-num {
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.mm-row.is-partner {
  grid-template-columns: 36px minmax(0, 1fr) 140px 140px;
  cursor: default;
}
.mm-row:hover,
.mm-row:focus-visible {
  background: color-mix(in oklch, var(--color-base-foreground) 4%, transparent);
  outline: none;
}
.mm-row.is-partner:hover {
  background: transparent;
}
.mm-row.is-open,
.mm-row.is-picked {
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
}
.mm-cell {
  overflow: hidden;
  color: var(--color-muted-foreground);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mm-partner-mark {
  display: inline-flex;
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  border-radius: 28%;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
.mm-check {
  position: absolute;
  right: -4px;
  bottom: -4px;
  width: 16px;
  height: 16px;
  border: 1.5px solid var(--color-base-foreground);
  border-radius: 5px;
  background: var(--color-base-background);
}
.mm-check.is-static {
  position: static;
}
.mm-check.is-on {
  background: var(--color-base-foreground)
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4 8.5l2.5 2.5L12 5.5' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")
    center / 12px no-repeat;
}
:root[data-ds-theme='light'] .mm-check.is-on {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4 8.5l2.5 2.5L12 5.5' fill='none' stroke='%23fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
}
.mm-fav {
  fill: currentColor;
  color: var(--color-mar-gold, #f5c84c);
}
.mm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}
.mm-card {
  padding: 14px;
  border-radius: 16px;
  cursor: pointer;
  font-size: 13px;
}
.mm-card.is-open,
.mm-card.is-picked {
  box-shadow: inset 0 0 0 1.5px var(--color-base-foreground);
}
.mm-page:has(.mm-side) .mm-row {
  grid-template-columns: 36px minmax(0, 1fr) 64px 190px;
}
.mm-page:has(.mm-side) .mm-row > .mm-cell:nth-of-type(3),
.mm-page:has(.mm-side) .mm-row > .mm-cell:nth-of-type(4),
.mm-page:has(.mm-side) .mm-row > .mm-cell:nth-of-type(6) {
  display: none;
}
.mm-page:has(.mm-side) .mm-head {
  flex-wrap: wrap;
}
</style>
