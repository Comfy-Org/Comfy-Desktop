<script setup lang="ts">
import { ExternalLink } from 'lucide-vue-next'
import Button from '../../../ui/Button.vue'

/** The Theme playground is its own page, full screen over the real
 *  surfaces (studio/ThemeStudio.vue): this entry says what it does and
 *  opens it. */
const href = `${location.pathname}?playground`
</script>

<template>
  <div class="pgl">
    <p>
      Edit charcoal’s OKLCH curve, the brand and status hues and the semantic mapping for dark and
      light, and watch them land on the prototype’s own New Home and ComfyUI graph. Contrast (WCAG
      and APCA), the legacy names and the patch for ComfyUI_frontend sit in the editor beside them.
    </p>
    <Button as="a" variant="primary" :href
      >Open the Theme playground<ExternalLink :size="14"
    /></Button>
  </div>
</template>

<style>
.pgl {
  display: flex;
  max-width: 640px;
  flex-direction: column;
  align-items: flex-start;
  gap: 16px;
  color: var(--color-muted-foreground);
  font-size: 13px;
  line-height: 20px;
}
.pgl p {
  margin: 0;
}
</style>
