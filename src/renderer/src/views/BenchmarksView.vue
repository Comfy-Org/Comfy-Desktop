<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import BrandBackground from '../components/BrandBackground.vue'
import ComfyWordmark from '../components/icons/ComfyWordmark.vue'

const { t } = useI18n()
</script>

<template>
  <BrandBackground class="benchmarks" data-testid="benchmarks">
    <div class="benchmarks__layout">
      <ComfyWordmark
        class="benchmarks__wordmark"
        data-testid="benchmarks-logo"
        aria-hidden="true"
      />
      <p class="benchmarks__description">{{ t('benchmarks.description') }}</p>
    </div>
  </BrandBackground>
</template>

<style scoped>
.benchmarks {
  min-height: 0;
}

.benchmarks__layout {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  min-height: 100%;
  gap: 24px;
  text-align: left;
}

.benchmarks__wordmark {
  display: block;
  width: clamp(120px, 8vw, 180px);
  height: auto;
  aspect-ratio: 173 / 48;
  color: var(--comfy-yellow);
  flex-shrink: 0;
  anchor-name: --brand-beam-target;
}

.benchmarks__description {
  max-width: 560px;
  margin: 0;
  color: var(--text-muted);
  font-size: 16px;
  line-height: 1.5;
}
</style>
