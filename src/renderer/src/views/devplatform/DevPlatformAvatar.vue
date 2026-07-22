<script setup lang="ts">
/**
 * Square gradient avatar — ported verbatim from the ComfyUI frontend's
 * `WorkspaceProfilePic.vue` so the same subject renders the SAME colour here as
 * in the web frontend. The PRNG and hue/sat/light maths are a wire format: any
 * change silently breaks that cross-surface identity.
 *
 * Used for both the signed-in account (seeded from the email) and workspace
 * rows (seeded from the workspace name) — the colour is a deterministic
 * function of whatever string it is given.
 */
import { computed } from 'vue'

const { name } = defineProps<{
  /** Subject the colour is derived from; only its first character is rendered. */
  name: string
}>()

const letter = computed(() => name?.charAt(0)?.toUpperCase() || '?')

/** mulberry32 — the frontend's PRNG, ported verbatim. */
function mulberry32(a: number): () => number {
  return function () {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Two-stop gradient seeded from the letter. The rand() call ORDER and COUNT are
 *  part of the contract — reordering or adding a call changes every colour.
 *
 *  The second stop's hue spread is narrowed against the frontend's 40–120°: at
 *  that width the two stops read as two separate colours rather than one shaded
 *  one. hue1/sat/light are untouched, so the colour family still matches. */
const gradient = computed(() => {
  const rand = mulberry32(letter.value.charCodeAt(0))
  const hue1 = Math.floor(rand() * 360)
  const hue2 = (hue1 + 18 + Math.floor(rand() * 24)) % 360
  const sat = 65 + Math.floor(rand() * 20)
  const light = 55 + Math.floor(rand() * 15)
  return `linear-gradient(135deg, hsl(${hue1}, ${sat}%, ${light + 6}%), hsl(${hue2}, ${sat}%, ${light - 6}%))`
})
</script>

<template>
  <!-- Decorative: the subject's name is always rendered beside this avatar. -->
  <span class="dp-avatar" :style="{ background: gradient }" aria-hidden="true">
    {{ letter }}
  </span>
</template>

<style scoped>
.dp-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: var(--dp-avatar-size, 32px);
  height: var(--dp-avatar-size, 32px);
  border-radius: 6px;
  overflow: hidden;
  /* Paired to the generated gradient, not the app palette — same values as
   * the frontend component this is ported from. */
  color: #fff;
  /* Scales with the box so the letter keeps the same optical weight at any size. */
  font-size: calc(var(--dp-avatar-size, 32px) * 0.42);
  font-weight: 600;
  line-height: 1;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  user-select: none;
}
</style>
