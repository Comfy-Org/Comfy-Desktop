<script setup lang="ts">
import { computed } from 'vue'
import { Copy, ExternalLink, FolderOpen, Star, Trash2, X } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import { toast } from '../../useProto'
import ModelStatus from './ModelStatus.vue'
import ModelTile from './ModelTile.vue'
import {
  fmtSize,
  MODEL_BUILDS,
  MODELS_FOLDER,
  modelsApi,
  modelsState,
  SOURCE_LABEL,
  TYPE_LABEL,
  type Model
} from './models'

/** The model's info panel, after the frontend's ModelInfoPanel: what it is,
 *  where it came from, what it's compatible with, who uses it, and the
 *  actions. */
const { model } = defineProps<{ model: Model }>()
const emit = defineEmits<{ close: []; delete: [id: string] }>()
const fav = computed(() => modelsState.favorites.includes(model.id))
const path = computed(() => `${MODELS_FOLDER}/${model.folder}/${model.file}`)

function copy(text: string, what: string): void {
  void navigator.clipboard?.writeText(text).catch(() => undefined)
  toast(`${what} copied`)
}
</script>

<template>
  <aside class="mm-detail mar-surface" :aria-label="`${model.name} details`">
    <header class="flex items-start gap-3">
      <ModelTile :model :size="44" />
      <div class="min-w-0 flex-1">
        <h2 class="text-[17px] leading-tight font-semibold">{{ model.name }}</h2>
        <p class="mt-1 truncate font-mono text-[11px] text-subtle-foreground">{{ model.file }}</p>
      </div>
      <Button
        size="sm"
        variant="ghost"
        :aria-label="fav ? 'Remove from favorites' : 'Add to favorites'"
        :aria-pressed="fav"
        @click="modelsApi.toggleFavorite(model.id)"
        ><Star :size="14" :class="fav && 'mm-fav-on'"
      /></Button>
      <Button size="sm" variant="ghost" aria-label="Close details" @click="emit('close')"
        ><X :size="14"
      /></Button>
    </header>

    <p class="mt-4 text-ui leading-relaxed text-muted-foreground">{{ model.description }}</p>

    <div class="mt-4"><ModelStatus :model wide /></div>

    <dl class="mm-meta">
      <dt>Type</dt>
      <dd>{{ TYPE_LABEL[model.type] }}</dd>
      <dt>Base model</dt>
      <dd>{{ model.base }}</dd>
      <dt>Size</dt>
      <dd>{{ fmtSize(model.sizeGb) }}</dd>
      <dt>Source</dt>
      <dd>
        <button class="mm-link" @click="toast(`Opens ${SOURCE_LABEL[model.source]}`)">
          {{ SOURCE_LABEL[model.source] }} · {{ model.author }}<ExternalLink :size="11" />
        </button>
      </dd>
      <dt>License</dt>
      <dd>{{ model.license }}</dd>
      <dt>Folder</dt>
      <dd class="font-mono text-[11px]">{{ model.folder }}</dd>
      <template v-if="model.installed">
        <dt>Added</dt>
        <dd>{{ model.addedAt }}</dd>
      </template>
      <dt>SHA256</dt>
      <dd class="font-mono text-[11px]">{{ model.sha256 }}</dd>
    </dl>

    <section v-if="model.triggers?.length" class="mt-5">
      <div class="flex items-center justify-between">
        <h3 class="mm-h">Trigger words</h3>
        <Button size="sm" variant="link" @click="copy(model.triggers.join(', '), 'Trigger words')"
          ><Copy :size="12" />Copy all</Button
        >
      </div>
      <div class="mt-2 flex flex-wrap gap-1.5">
        <span v-for="t in model.triggers" :key="t" class="mm-chip">{{ t }}</span>
      </div>
    </section>

    <section class="mt-5">
      <h3 class="mm-h">Used by</h3>
      <p
        v-if="!model.usedBy.length && !model.workflows.length"
        class="mt-2 text-ui text-subtle-foreground"
      >
        Nothing loads it yet.
      </p>
      <ul v-else class="mt-2 flex flex-col gap-1 text-ui">
        <li v-for="b in model.usedBy" :key="b" class="mm-used">
          <span class="mm-used-kind">Build</span>{{ MODEL_BUILDS[b] ?? b }}
        </li>
        <li v-for="w in model.workflows" :key="w" class="mm-used">
          <span class="mm-used-kind">Workflow</span>{{ w }}
        </li>
      </ul>
    </section>

    <footer v-if="model.installed" class="mt-auto flex flex-wrap gap-2 pt-6">
      <Button size="sm" variant="subtle" @click="toast('Shows it in Finder')"
        ><FolderOpen :size="13" />Show in Finder</Button
      >
      <Button size="sm" variant="ghost" @click="copy(path, 'Path')"
        ><Copy :size="13" />Copy path</Button
      >
      <Button
        size="sm"
        variant="ghost"
        class="ml-auto"
        aria-label="Delete model"
        @click="emit('delete', model.id)"
        ><Trash2 :size="13" />Delete</Button
      >
    </footer>
  </aside>
</template>

<style scoped>
.mm-detail {
  position: sticky;
  top: 16px;
  display: flex;
  max-height: calc(100vh - 140px);
  flex-direction: column;
  overflow-y: auto;
  padding: 18px;
  border-radius: 18px;
}
.mm-meta {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 8px 12px;
  margin-top: 18px;
  font-size: 13px;
}
.mm-meta dt {
  color: var(--color-subtle-foreground);
}
.mm-meta dd {
  overflow: hidden;
  text-overflow: ellipsis;
}
:root .proto-ui.proto-ui.proto-ui .mm-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  text-decoration: underline;
  text-decoration-color: color-mix(in oklch, currentColor 30%, transparent);
  text-underline-offset: 3px;
}
.mm-h {
  color: var(--color-subtle-foreground);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.mm-chip {
  padding: 3px 9px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  font-size: 12px;
}
.mm-used {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.mm-used-kind {
  width: 64px;
  flex-shrink: 0;
  color: var(--color-subtle-foreground);
  font-size: 11px;
}
.mm-fav-on {
  fill: currentColor;
  color: var(--color-mar-gold, #f5c84c);
}
</style>
