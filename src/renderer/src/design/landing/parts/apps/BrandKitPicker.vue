<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, Loader2, Plus } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Input from '../../ui/Input.vue'
import Switch from '../../ui/Switch.vue'
import { cn } from '../../ui/cn'
import ComfyCLogo from '../../../../components/icons/ComfyCLogo.vue'
import SpaceMark from '../space/SpaceMark.vue'
import { toast } from '../../useProto'
import { flow } from '../../appFlow'
import { addKitFromSite, BRAND_KITS, fontOf, withKit, type AppFont } from '../../appTheme'

/**
 * Brand kits saved in the workspace, as cards: logo, colors, type. Pick
 * one and the app takes it on. No kit yet? Add one here: Comfy reads it
 * from your website (logo, colors, type), and can save it for next time.
 */
const d = computed(() => flow.draft!)
const current = computed(() => d.value.theme.kit)
function pick(id: string | null): void {
  d.value.theme = withKit(d.value.theme, id)
}

const adding = ref(false)
const url = ref('atelier-noir.com')
const save = ref(true)
const reading = ref(-1)
const READ = ['Found the logo', 'Found 3 colors', 'Matched the type: a serif']
function read(): void {
  if (!url.value.trim() || reading.value >= 0) return
  reading.value = 0
  const tick = (): void => {
    if (reading.value < READ.length) {
      reading.value++
      setTimeout(tick, 500)
      return
    }
    const kit = addKitFromSite(url.value)
    pick(kit.id)
    adding.value = false
    reading.value = -1
    toast(save.value ? `${kit.name} is saved to Silverside's brand kits` : `Using ${kit.name}`)
  }
  setTimeout(tick, 300)
}
const fontLabel = (f?: AppFont): string => (f ? fontOf(f).label : 'Sans')
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="grid grid-cols-3 gap-2.5">
      <!-- No brand: Comfy's look -->
      <button
        type="button"
        :class="
          cn(
            'flex flex-col gap-3 rounded-card border bg-card-background p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-border-focus hover:bg-card-background-hover',
            !current ? 'border-base-foreground/70' : 'border-border-default'
          )
        "
        @click="pick(null)"
      >
        <span class="flex items-center justify-between">
          <span
            class="inline-flex size-8 items-center justify-center rounded-control bg-secondary-background"
            ><ComfyCLogo :size="16"
          /></span>
          <Check v-if="!current" :size="14" />
        </span>
        <span>
          <span class="block text-ui font-medium">No brand</span>
          <span class="block text-ui text-subtle-foreground">Comfy’s look</span>
        </span>
      </button>

      <button
        v-for="k in BRAND_KITS"
        :key="k.id"
        type="button"
        :class="
          cn(
            'flex flex-col gap-3 rounded-card border bg-card-background p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-border-focus hover:bg-card-background-hover',
            current === k.id ? 'border-base-foreground/70' : 'border-border-default'
          )
        "
        @click="pick(k.id)"
      >
        <span class="flex items-center justify-between">
          <SpaceMark :brand="k.brand" size="md" />
          <span class="flex -space-x-1">
            <span
              v-for="c in k.colors"
              :key="c"
              class="size-4 rounded-full ring-2 ring-card-background"
              :style="{ background: c }"
            />
          </span>
        </span>
        <span>
          <span class="flex items-center gap-1.5 text-ui font-medium"
            >{{ k.name }}<Check v-if="current === k.id" :size="13"
          /></span>
          <span class="block text-ui text-subtle-foreground"
            >{{ fontLabel(k.theme.font) }} type</span
          >
        </span>
      </button>

      <!-- Add one -->
      <button
        v-if="!adding"
        type="button"
        class="flex flex-col items-start justify-between gap-3 rounded-card border border-dashed border-border-strong p-3 text-left text-muted-foreground outline-none hover:bg-secondary-background hover:text-base-foreground focus-visible:ring-2 focus-visible:ring-border-focus"
        @click="adding = true"
      >
        <span
          class="inline-flex size-8 items-center justify-center rounded-control bg-secondary-background"
          ><Plus :size="15"
        /></span>
        <span>
          <span class="block text-ui font-medium">Add a brand kit</span>
          <span class="block text-ui text-subtle-foreground">From your website</span>
        </span>
      </button>
    </div>

    <!-- Add a kit: read it from a website -->
    <div v-if="adding" class="flex flex-col gap-3 rounded-card border border-border-default p-4">
      <p class="text-ui font-medium">Add a brand kit</p>
      <form class="flex gap-2" @submit.prevent="read">
        <Input v-model="url" placeholder="yourbrand.com" class="flex-1" :disabled="reading >= 0" />
        <Button type="submit" variant="primary" :disabled="reading >= 0">
          <Loader2 v-if="reading >= 0" :size="13" class="animate-spin" />Read my brand
        </Button>
      </form>
      <ul v-if="reading >= 0" class="flex flex-col gap-1.5">
        <li
          v-for="(r, i) in READ"
          :key="r"
          :class="
            cn(
              'flex items-center gap-2 text-ui',
              i < reading ? 'text-muted-foreground' : 'opacity-40'
            )
          "
        >
          <Check v-if="i < reading" :size="13" class="text-status-running" />
          <Loader2 v-else-if="i === reading" :size="13" class="animate-spin" />
          <span v-else class="size-[13px]" />{{ r }}
        </li>
      </ul>
      <div class="flex items-center justify-between gap-3">
        <span class="text-ui text-muted-foreground">Save to Silverside's brand kits</span>
        <Switch v-model="save" aria-label="Save to the workspace" />
      </div>
      <p class="text-ui text-subtle-foreground">
        Or upload a logo and pick the colors by hand later, in the style panel.
      </p>
    </div>
  </div>
</template>
