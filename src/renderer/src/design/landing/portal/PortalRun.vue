<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronLeft, ImageUp, Lock, ShieldCheck, Sparkles } from 'lucide-vue-next'
import Badge from '../ui/Badge.vue'
import Button from '../ui/Button.vue'
import Card from '../ui/Card.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'
import Select from '../ui/Select.vue'
import BrandButton from '../parts/space/BrandButton.vue'
import OutputTile from '../parts/space/OutputTile.vue'
import GraphPreview from '../parts/GraphPreview.vue'
import {
  clientUser,
  currentSpace,
  FLAVOR_LABEL,
  memberPrice,
  STUDIO,
  type SpaceOutput
} from '../spaces'
import { proto, toast } from '../useProto'
import { thumb } from '../mock'

/**
 * Run a tool. App: a form. Simplified workflow: the same inputs, plus the
 * graph it runs - visible but locked by the studio.
 */
const { toolId } = defineProps<{ toolId: string }>()
const space = computed(() => currentSpace.value)
const item = computed(() => space.value.catalog.find((c) => c.id === toolId))

const view = ref<'inputs' | 'graph'>('inputs')
const uploaded = ref(false)
const prompt = ref('')
const preset = ref(item.value?.presets[0] ?? 'default')
const aspect = ref<'1:1' | '4:5' | '16:9'>('1:1')
const count = ref('4')
const running = ref(false)
const results = ref<SpaceOutput[]>([])
const cost = computed(() => {
  const per = item.value?.cost ?? 0
  const price = space.value.payer === 'owner' ? per : memberPrice(space.value, per)
  return price * Number(count.value)
})
const payNote = computed(() =>
  space.value.payer === 'members'
    ? 'Charged to your Comfy credits'
    : space.value.payer === 'split'
      ? `Covered by ${space.value.name} up to your monthly allowance, then your credits`
      : ''
)

const POOL = [
  'image_flux2',
  'image_z_image_turbo',
  'image_krea2_turbo_t2i',
  'template_product_placement'
]
function generate(): void {
  if (!item.value) return
  running.value = true
  setTimeout(() => {
    const now = Array.from({ length: Number(count.value) }, (_, i) => ({
      id: `run-${Date.now()}-${i}`,
      thumbId: i === 0 ? item.value!.thumbId : POOL[i % POOL.length]!,
      tool: item.value!.name,
      by: clientUser.value.name,
      when: 'Just now',
      status: space.value.policies.approval ? ('review' as const) : ('approved' as const)
    }))
    results.value = now
    space.value.library.unshift(...now)
    space.value.used += cost.value
    item.value!.runs += now.length
    running.value = false
    if (space.value.policies.approval) toast('Sent for review - you can download once approved')
  }, 1400)
}
</script>

<template>
  <div v-if="item" class="mx-auto w-full max-w-280 px-10 pb-16">
    <Button variant="link" size="sm" class="mt-6 -mb-4" @click="proto.portalPage = 'tools'"
      ><ChevronLeft :size="14" />Tools</Button
    >
    <header class="flex items-end justify-between gap-6 pt-12 pb-8">
      <div>
        <div class="flex items-center gap-2.5">
          <h1 class="text-title font-semibold tracking-[-0.01em]">{{ item.name }}</h1>
          <Badge size="md">{{ FLAVOR_LABEL[item.flavor] }}</Badge>
        </div>
        <p class="mt-1 text-ui text-muted-foreground">{{ item.blurb }}</p>
      </div>
      <SegmentedControl
        v-if="item.flavor === 'workflow'"
        v-model="view"
        variant="contained"
        :options="[
          { value: 'inputs', label: 'Inputs' },
          { value: 'graph', label: 'Workflow' }
        ]"
      />
    </header>

    <div class="grid grid-cols-[minmax(0,380px)_minmax(0,1fr)] gap-5">
      <Card class="flex flex-col gap-4 self-start p-4">
        <button
          type="button"
          class="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-control border border-dashed border-border-strong bg-black/20 text-ui text-muted-foreground outline-none hover:bg-black/30 focus-visible:ring-2 focus-visible:ring-border-focus disabled:cursor-not-allowed"
          :disabled="!space.policies.uploads"
          @click="uploaded = true"
        >
          <img
            v-if="uploaded"
            :src="thumb(item.thumbId)"
            alt=""
            class="absolute inset-0 size-full object-cover"
          />
          <span v-else class="flex flex-col items-center gap-2">
            <ImageUp :size="20" />{{
              space.policies.uploads
                ? 'Drop a photo or click to upload'
                : 'Uploads are off in this space'
            }}
          </span>
        </button>
        <label class="flex flex-col gap-1.5">
          <span class="text-ui font-medium">Describe it</span>
          <textarea
            v-model="prompt"
            rows="3"
            placeholder="e.g. on a marble counter, morning light"
            class="resize-none rounded-control border border-border-default bg-secondary-background px-3 py-2 text-ui outline-none placeholder:text-subtle-foreground focus-visible:ring-2 focus-visible:ring-border-focus"
          />
        </label>
        <Select
          v-if="item.presets.length"
          v-model="preset"
          label="Style"
          :options="item.presets.map((p) => ({ value: p, label: p }))"
        />
        <div class="flex items-center gap-2">
          <SegmentedControl
            v-model="aspect"
            variant="contained"
            :options="[
              { value: '1:1', label: '1:1' },
              { value: '4:5', label: '4:5' },
              { value: '16:9', label: '16:9' }
            ]"
          />
          <Select
            v-model="count"
            label="Images"
            class="ml-auto w-28"
            :options="['1', '2', '4'].map((n) => ({ value: n, label: n }))"
          />
        </div>
        <BrandButton size="lg" :disabled="running" @click="generate">
          <Sparkles :size="14" />{{ running ? 'Generating…' : `Generate · ${cost} credits` }}
        </BrandButton>
        <p v-if="payNote" class="-mt-2 text-center text-ui text-subtle-foreground">
          {{ payNote }}
        </p>
        <p
          v-if="space.policies.approval || space.policies.watermark"
          class="flex items-center gap-1.5 text-ui text-subtle-foreground"
        >
          <ShieldCheck :size="12" />{{
            [
              space.policies.approval && 'Results are reviewed before download',
              space.policies.watermark && 'downloads are watermarked'
            ]
              .filter(Boolean)
              .join(' · ')
          }}
        </p>
      </Card>

      <div>
        <Card v-if="view === 'graph'" class="relative aspect-[16/10] overflow-hidden">
          <GraphPreview :thumb-id="item.thumbId" :zoom="0.55" />
          <Badge variant="overlay" size="tag" class="absolute top-3 left-3"
            ><Lock :size="12" />Locked by {{ STUDIO.name }} · you can change the inputs</Badge
          >
        </Card>
        <div
          v-else-if="running || results.length"
          class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3.5"
        >
          <template v-if="running">
            <div
              v-for="n in Number(count)"
              :key="n"
              class="aspect-square animate-pulse rounded-card bg-secondary-background"
            />
          </template>
          <template v-else>
            <OutputTile v-for="o in results" :key="o.id" :out="o" :space />
          </template>
        </div>
        <Card
          v-else
          variant="dashed"
          class="flex aspect-[16/10] flex-col items-center justify-center gap-2 text-center"
        >
          <Sparkles :size="20" class="text-subtle-foreground" />
          <p class="text-ui">Results show up here</p>
          <p class="text-ui text-subtle-foreground">
            {{ item.runs.toLocaleString('en-US') }} runs in {{ space.name }} so far
          </p>
        </Card>
      </div>
    </div>
  </div>
</template>
