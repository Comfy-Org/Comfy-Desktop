<script setup lang="ts">
/**
 * Workspace avatar — ported verbatim from the ComfyUI frontend's
 * `WorkspaceProfilePic.vue` so a workspace renders the SAME colour here as in
 * the web frontend's pickers. The PRNG and hue/sat/light maths are a wire
 * format: any change silently breaks that cross-surface identity.
 */
import { computed } from 'vue'

const { workspaceName } = defineProps<{
  /** Display name; only its first character is used. */
  workspaceName: string
}>()

const letter = computed(() => workspaceName?.charAt(0)?.toUpperCase() || '?')

/** mulberry32 — the frontend's PRNG, ported verbatim. */
function mulberry32(a: number): () => number {
  return function () {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Two-stop gradient seeded from the letter. The rand() call ORDER is part of
 *  the contract — reordering changes every colour. */
const gradient = computed(() => {
  const rand = mulberry32(letter.value.charCodeAt(0))
  const hue1 = Math.floor(rand() * 360)
  const hue2 = (hue1 + 40 + Math.floor(rand() * 80)) % 360
  const sat = 65 + Math.floor(rand() * 20)
  const light = 55 + Math.floor(rand() * 15)
  return `linear-gradient(135deg, hsl(${hue1}, ${sat}%, ${light}%), hsl(${hue2}, ${sat}%, ${light}%))`
})
</script>

<template>
  <!-- Decorative: the workspace name is always rendered beside this avatar. -->
  <span class="ws-avatar" :style="{ background: gradient }" aria-hidden="true">
    {{ letter }}
  </span>
</template>

<style scoped>
.ws-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: var(--ws-avatar-size, 32px);
  height: var(--ws-avatar-size, 32px);
  border-radius: 6px;
  overflow: hidden;
  /* Paired to the generated gradient, not the app palette — same values as
   * the frontend component this is ported from. */
  color: #fff;
  font-size: var(--takeover-fs-body);
  font-weight: 600;
  line-height: 1;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  user-select: none;
}
</style>
