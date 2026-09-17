<script setup lang="ts">
import ComfyWordmark from './icons/ComfyWordmark.vue'

defineProps<{
  title: string
  description: string
  logoTestId?: string
}>()
</script>

<template>
  <header class="branded-page-header">
    <ComfyWordmark
      class="branded-page-header__wordmark"
      :data-testid="logoTestId"
      aria-hidden="true"
    />
    <div>
      <h1>{{ title }}</h1>
      <p class="branded-page-header__description">{{ description }}</p>
    </div>
  </header>
</template>

<style scoped>
.branded-page-header {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 28px;
  width: 100%;
  padding-right: 280px;
}

.branded-page-header h1 {
  margin: 0 0 4px;
  color: var(--neutral-100);
  font-size: 24px;
  font-weight: 600;
  line-height: 1.2;
}

.branded-page-header__wordmark {
  display: block;
  width: clamp(120px, 8vw, 180px);
  height: auto;
  aspect-ratio: 173 / 48;
  color: var(--comfy-yellow);
  flex-shrink: 0;
  anchor-name: --brand-beam-target;
}

.branded-page-header__description {
  margin: 0;
  color: var(--text-muted);
  font-size: 14px;
}

@media (max-width: 800px) {
  .branded-page-header {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
    padding-right: 0;
  }
}
</style>
