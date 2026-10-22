<script setup lang="ts">
import { computed } from 'vue'
import { Check, ImageUp, Pipette } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Input from '../../ui/Input.vue'
import { cn } from '../../ui/cn'
import SpaceMark from './SpaceMark.vue'
import { spaceById } from '../../spaces'
import { toast } from '../../useProto'
import { BRAND_SWATCHES } from '../../mock'

/** A space's brand: what members see instead of Comfy. */
const { spaceId } = defineProps<{ spaceId: string }>()
const brand = computed(() => spaceById(spaceId)!.brand)
function setColor(v: string): void {
  if (/^#[0-9a-f]{6}$/i.test(v)) brand.value.color = v
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <section>
      <p class="mb-2 text-ui font-medium">Logo</p>
      <div
        class="flex items-center gap-3 rounded-control border border-border-default bg-black/20 p-3"
      >
        <SpaceMark :brand size="md" named class="flex-1" />
        <Button size="sm" @click="toast('Upload logo (SVG or PNG)')"
          ><ImageUp :size="13" />Replace</Button
        >
      </div>
      <Input v-model="brand.logo.name" class="mt-2" aria-label="Display name" />
      <p class="mt-1.5 text-ui text-subtle-foreground">
        Shown in the portal header, emails and the browser tab. Comfy only appears as "Powered by
        Comfy" in the footer.
      </p>
    </section>

    <section>
      <p class="mb-2 text-ui font-medium">Brand colour</p>
      <div class="flex flex-wrap gap-2.5">
        <button
          v-for="c in BRAND_SWATCHES"
          :key="c"
          type="button"
          :class="
            cn(
              'relative inline-flex size-8 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
              brand.color === c &&
                'ring-2 ring-base-foreground ring-offset-2 ring-offset-card-background'
            )
          "
          :style="{
            background: `linear-gradient(135deg, ${c}, color-mix(in oklab, ${c} 55%, #111))`
          }"
          :aria-label="`Brand colour ${c}`"
          @click="brand.color = c"
        >
          <Check v-if="brand.color === c" :size="14" class="text-white" />
        </button>
      </div>
      <Input
        :model-value="brand.color"
        mono
        class="mt-2"
        aria-label="Custom hex colour"
        @update:model-value="setColor"
      >
        <template #leading><Pipette :size="13" class="text-subtle-foreground" /></template>
      </Input>
      <p class="mt-1.5 text-ui text-subtle-foreground">
        Used for the logo, the home glow and primary buttons in the portal.
      </p>
    </section>

    <section>
      <p class="mb-2 text-ui font-medium">Headline</p>
      <Input v-model="brand.headline" placeholder="Hi {name}, what are we making today?" />
      <p class="mt-1.5 text-ui text-subtle-foreground">Use {name} for the person's first name.</p>
    </section>

    <section>
      <p class="mb-2 text-ui font-medium">Announcement</p>
      <Input v-model="brand.announcement" placeholder="New tools, changes, deadlines…" />
      <p class="mt-1.5 text-ui text-subtle-foreground">
        Shown at the top of the portal home when the Announcement section is on.
      </p>
    </section>
  </div>
</template>
