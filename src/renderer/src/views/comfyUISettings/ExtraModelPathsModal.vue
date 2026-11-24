<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import { FileText, RefreshCw } from '@lucide/vue'
import BaseModal from '../../components/ui/BaseModal.vue'
import InfoTooltip from '../../components/InfoTooltip.vue'
import RevealFolderButton from '../../components/RevealFolderButton.vue'
import { MODAL_TITLE_CLASS } from '../../lib/modalTitle'

export interface ExtraModelPathDir {
  type: string
  rawType: string
  dir: string
  dirExists: boolean
}

export interface ExtraModelPathSection {
  name: string
  basePath: string | null
  basePathExists: boolean
  isDefault: boolean
  dirs: ExtraModelPathDir[]
}

interface Props {
  open: boolean
  sections: ExtraModelPathSection[]
  yamlPath: string
}

defineProps<Props>()

const emit = defineEmits<{
  close: []
  'open-path': [path: string]
  'reveal-path': [path: string]
  refresh: []
}>()

const { t } = useI18n()
</script>

<template>
  <BaseModal
    :open="open"
    size="md"
    close-outside
    :aria-label="t('comfyUISettings.extraModelPathsModalTitle')"
    @close="emit('close')"
  >
    <template #header>
      <div class="empm-header flex min-w-0 items-center gap-2">
        <h2 class="empm-title m-0 min-w-0 truncate" :class="MODAL_TITLE_CLASS">
          {{ t('comfyUISettings.extraModelPathsModalTitle') }}
        </h2>
        <Button
          variant="textonly"
          size="unset"
          type="button"
          class="empm-refresh static ml-auto inline-flex size-7 items-center justify-center rounded-md border border-solid border-transparent bg-transparent p-0 font-normal leading-[1.5] text-text-muted appearance-auto transition-[background-color,color] duration-100 ease-[ease] hover:bg-[var(--brand-surface-bg-hover)] hover:text-neutral-100 focus-visible:bg-[var(--brand-surface-bg-hover)] focus-visible:text-neutral-100 focus-visible:outline-none focus-visible:ring-0"
          :aria-label="t('comfyUISettings.refreshCustomPaths')"
          :title="t('comfyUISettings.refreshCustomPaths')"
          @click="emit('refresh')"
        >
          <RefreshCw :size="14" aria-hidden="true" />
        </Button>
      </div>
      <p
        v-if="yamlPath"
        class="empm-section-name mt-0.5 mr-0 mb-0 ml-0 truncate text-[12px] text-text-muted font-mono"
      >
        {{ yamlPath }}
      </p>
    </template>

    <p class="empm-note mt-0 mr-0 mb-3 ml-0 text-[12px] leading-[1.45] opacity-75">
      {{ t('comfyUISettings.extraModelPathsModalNote') }}
    </p>

    <section
      v-for="(section, si) in sections"
      :key="`${section.name}-${si}`"
      class="empm-section mb-4 last:mb-0"
    >
      <div class="empm-section-head mb-1.5 flex items-center gap-2">
        <span class="empm-section-title text-[13px] font-semibold">{{ section.name }}</span>
        <span
          v-if="section.isDefault"
          class="empm-tag inline-flex flex-none items-center gap-0.5 rounded-[999px] border border-solid border-[var(--chooser-surface-border)] bg-[color-mix(in_srgb,var(--text)_6%,transparent)] px-1.5 py-px text-[10px] leading-[14px] font-medium tracking-[0.02em] text-text-muted uppercase"
        >
          {{ t('common.default') }}
          <InfoTooltip :text="t('tooltips.extraModelPathsDefault')" />
        </span>
      </div>
      <div
        v-if="section.basePath"
        class="empm-base-path-row mb-1.5 flex min-w-0 items-center gap-1"
      >
        <span
          class="empm-base-path block min-w-0 max-w-full truncate text-left text-[12px] leading-[1.5] font-normal font-mono"
          :class="section.basePathExists ? 'text-text-muted' : 'is-missing text-danger'"
          :title="
            section.basePathExists
              ? section.basePath
              : t('comfyUISettings.dirMissingTitle', { dir: section.basePath })
          "
          >{{ section.basePath }}</span
        >
        <RevealFolderButton
          v-if="section.basePathExists"
          class="empm-base-path-reveal -my-1"
          :path="section.basePath"
          @click="emit('open-path', section.basePath)"
        />
      </div>

      <ul
        class="empm-dirs m-0 flex list-none flex-col rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-[var(--brand-surface-bg)] p-0"
      >
        <li
          v-for="(d, i) in section.dirs"
          :key="`${d.rawType}-${i}`"
          class="empm-dir flex min-w-0 items-center gap-2 border-t border-solid border-border-hover px-2.5 py-2 first:border-t-0"
        >
          <span class="empm-dir-type min-w-[92px] flex-none text-[11px] font-semibold opacity-85">{{
            d.rawType
          }}</span>
          <span
            class="empm-dir-path block min-w-0 max-w-full flex-[0_1_auto] truncate text-left text-[12px] leading-[1.5] font-normal"
            :class="d.dirExists ? 'text-neutral-100' : 'is-missing text-danger'"
            :title="d.dirExists ? d.dir : t('comfyUISettings.dirMissingTitle', { dir: d.dir })"
            >{{ d.dir }}</span
          >
          <RevealFolderButton
            v-if="d.dirExists"
            class="empm-dir-reveal -my-1.5"
            :path="d.dir"
            @click="emit('open-path', d.dir)"
          />
        </li>
      </ul>
    </section>

    <template #footer>
      <Button
        variant="textonly"
        size="unset"
        type="button"
        class="empm-action static inline-flex items-center justify-normal gap-1.5 rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-transparent px-3 py-1.5 text-[13px] leading-[1.5] font-normal whitespace-normal text-neutral-100 appearance-auto transition-[background-color,color] duration-100 ease-[ease] hover:bg-transparent enabled:hover:bg-[var(--brand-surface-bg-hover)] enabled:focus-visible:bg-[var(--brand-surface-bg-hover)] enabled:focus-visible:outline-none focus-visible:ring-0 disabled:pointer-events-auto disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="!yamlPath"
        @click="emit('reveal-path', yamlPath)"
      >
        <FileText :size="14" aria-hidden="true" />
        <span>{{ t('comfyUISettings.revealYaml') }}</span>
      </Button>
    </template>
  </BaseModal>
</template>
