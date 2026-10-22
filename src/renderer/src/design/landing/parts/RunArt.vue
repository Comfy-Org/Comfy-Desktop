<script setup lang="ts">
/** Line illustrations for where ComfyUI runs (not outputs).
 *  cloud: a cloud over a row of GPU chips. local: a laptop with a node graph. */
const { kind } = defineProps<{ kind: 'cloud' | 'local' }>()
</script>

<template>
  <svg
    viewBox="0 0 200 128"
    fill="none"
    stroke="currentColor"
    stroke-width="1.4"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="text-white/55"
  >
    <template v-if="kind === 'cloud'">
      <!-- cloud -->
      <path
        d="M62 58h76a20 20 0 0 0-6-39 28 28 0 0 0-53-6 22 22 0 0 0-17 45z"
        class="fill-white/[0.04]"
      />
      <!-- links down to GPUs -->
      <path d="M78 58v14M100 58v14M122 58v14" stroke-dasharray="2 3" />
      <!-- GPU chips -->
      <g v-for="(x, i) in [62, 88, 114]" :key="i">
        <rect :x="x" y="74" width="24" height="24" rx="3" class="fill-white/[0.05]" />
        <rect :x="x + 7" y="81" width="10" height="10" rx="1.5" />
        <path
          :d="`M${x + 6} 74v-3M${x + 12} 74v-3M${x + 18} 74v-3M${x + 6} 98v3M${x + 12} 98v3M${x + 18} 98v3`"
        />
      </g>
      <circle cx="148" cy="36" r="2" class="fill-current stroke-none" />
      <circle cx="54" cy="30" r="1.5" class="fill-current stroke-none" />
    </template>
    <template v-else>
      <!-- laptop -->
      <rect x="44" y="22" width="112" height="72" rx="6" class="fill-white/[0.04]" />
      <path d="M32 100h136l-8 8H40z" class="fill-white/[0.05]" />
      <!-- node graph on screen -->
      <rect x="58" y="36" width="26" height="16" rx="3" />
      <rect x="58" y="62" width="26" height="16" rx="3" />
      <rect x="98" y="46" width="22" height="22" rx="3" />
      <rect x="130" y="50" width="16" height="14" rx="3" class="fill-white/[0.08]" />
      <path d="M84 44c8 0 6 10 14 10M84 70c8 0 6-10 14-10M120 57h10" />
    </template>
  </svg>
</template>
