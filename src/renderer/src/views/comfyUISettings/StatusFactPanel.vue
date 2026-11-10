<script setup lang="ts">
import { computed, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import { Pencil } from 'lucide-vue-next'
import BaseCopyButton from '../../components/ui/BaseCopyButton.vue'
import type { DetailField, DetailSection, Installation } from '../../types/ipc'
import { useSessionStore } from '../../stores/sessionStore'

interface Props {
  installation: Installation | null
  sections: DetailSection[]
  diskUsage: { label: string; value: string } | null
  onRename?: (newName: string) => Promise<boolean>
  onUpdateUrl?: (newUrl: string) => Promise<boolean>
  urlRestartPending?: boolean
}

const props = defineProps<Props>()

const { t } = useI18n()
const sessionStore = useSessionStore()

function openPath(path: string): void {
  if (path && path !== '—') void window.api.openPath(path)
}

const nameEditable = computed(() => props.installation?.sourceCategory !== 'cloud')

const nameEl = useTemplateRef<HTMLElement>('nameEl')

function syncName(): void {
  const el = nameEl.value
  if (!el) return
  const name = props.installation?.name ?? ''
  if (el.textContent !== name) el.textContent = name
}

watch(
  [() => props.installation?.name ?? '', nameEl],
  () => {
    if (document.activeElement !== nameEl.value) syncName()
  },
  { immediate: true, flush: 'post' }
)

function focusName(): void {
  const el = nameEl.value
  if (!el) return
  el.focus()
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

function handleNameSelectAll(event: KeyboardEvent): void {
  event.preventDefault()
  const el = event.currentTarget as HTMLElement
  const range = document.createRange()
  range.selectNodeContents(el)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

function handleNamePaste(event: ClipboardEvent): void {
  event.preventDefault()
  const text = event.clipboardData?.getData('text/plain') ?? ''
  document.execCommand('insertText', false, text)
}

function handleNameEscape(): void {
  syncName()
  nameEl.value?.blur()
}

async function handleNameBlur(event: FocusEvent): Promise<void> {
  const el = event.target as HTMLElement
  const current = props.installation?.name ?? ''
  const newName = el.textContent?.trim() ?? ''
  if (newName && newName !== current) {
    if (el.textContent !== newName) el.textContent = newName
    const committed = await props.onRename?.(newName)
    if (committed === false) syncName()
    return
  }
  syncName()
}

const urlEditable = computed(() => props.installation?.sourceCategory === 'remote')

function isValidConnectionUrl(raw: string): boolean {
  const trimmed = raw.trim()
  if (!trimmed) return false
  try {
    const parsed = new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`)
    return parsed.hostname.length > 0
  } catch {
    return false
  }
}

const showUrlRestart = computed(() => {
  const id = props.installation?.id
  return !!props.urlRestartPending && !!id && sessionStore.isRunning(id)
})

const urlElRaw = useTemplateRef<HTMLElement | HTMLElement[]>('urlEl')
const urlEl = computed<HTMLElement | null>(() =>
  Array.isArray(urlElRaw.value) ? (urlElRaw.value[0] ?? null) : (urlElRaw.value ?? null)
)
function currentUrl(): string {
  for (const section of props.sections) {
    for (const field of section.fields ?? []) {
      if (field.id === 'remoteUrl') {
        const v = typeof field.value === 'string' ? field.value : ''
        if (v && v !== '—') return v
      }
    }
  }
  const fallback = props.installation?.remoteUrl
  return typeof fallback === 'string' ? fallback : ''
}
function syncUrl(): void {
  const el = urlEl.value
  if (!el) return
  const url = currentUrl()
  if (el.textContent !== url) el.textContent = url
}
watch(
  [() => currentUrl(), urlEl],
  () => {
    if (document.activeElement !== urlEl.value) syncUrl()
  },
  { immediate: true, flush: 'post' }
)

function handleUrlEscape(): void {
  syncUrl()
  urlEl.value?.blur()
}

function focusUrlField(): void {
  const el = urlEl.value
  if (!el) return
  el.focus()
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

function isUrlRow(row: { id: string }): boolean {
  return urlEditable.value && row.id === 'remoteUrl'
}

async function handleUrlBlur(event: FocusEvent): Promise<void> {
  const el = event.target as HTMLElement
  const current = currentUrl()
  const next = el.textContent?.trim() ?? ''
  if (!next || next === current || !isValidConnectionUrl(next)) {
    syncUrl()
    return
  }
  const committed = await props.onUpdateUrl?.(next)
  if (committed === false) syncUrl()
}

interface FactRow {
  id: string
  label: string
  value: string
  copyable?: boolean
  openable?: boolean
  truncate?: 'start' | 'end'
}

interface FactGroup {
  id: string
  title: string
  rows: FactRow[]
}

const allFields = computed<DetailField[]>(() => {
  const out: DetailField[] = []
  for (const section of props.sections) {
    for (const field of section.fields ?? []) {
      out.push(field)
    }
  }
  return out
})

function fieldValue(field: DetailField): string {
  const v = field.value
  if (v == null || v === '') return '—'
  return String(v)
}

function looksLikeDate(value: string): boolean {
  return /^[\d/.\-: ]+$/.test(value)
}

function isPathLike(value: string): boolean {
  if (!value || value === '—') return false
  if (looksLikeDate(value)) return false
  return value.includes('/') || value.includes('\\') || value.startsWith('~')
}

function matchLabel(field: DetailField, keys: string[]): boolean {
  const extra = field as DetailField & { key?: string }
  const id = (field.id ?? extra.key ?? '').toLowerCase()
  const label = field.label.toLowerCase()
  return keys.some((k) => id.includes(k) || label.includes(k.toLowerCase()))
}

function toRow(field: DetailField): FactRow {
  const value = fieldValue(field)
  const extra = field as DetailField & { key?: string }
  return {
    id: field.id ?? extra.key ?? field.label,
    label: field.label,
    value,
    copyable: isPathLike(value)
  }
}

const installDetailRows = computed<FactRow[]>(() => {
  const used = new Set<string>()
  const rows: FactRow[] = []
  const sourceLabel = props.installation?.sourceLabel?.toLowerCase()
  for (const field of allFields.value) {
    if (matchLabel(field, ['lineage'])) continue
    if (matchLabel(field, ['location', 'path', 'disk'])) continue
    if (matchLabel(field, ['active-port'])) continue
    if (matchLabel(field, ['install method', 'method'])) continue
    const row = toRow(field)
    if (sourceLabel && row.value.toLowerCase() === sourceLabel) continue
    if (row.value === '—' && !field.label) continue
    rows.push(row)
    used.add(row.id)
  }
  return rows
})

const locationRows = computed<FactRow[]>(() => {
  const rows: FactRow[] = []
  for (const field of allFields.value) {
    if (matchLabel(field, ['location', 'path', 'install path'])) {
      const row = toRow(field)
      if (isPathLike(row.value)) {
        row.truncate = 'start'
        row.openable = true
      }
      rows.push(row)
    }
  }
  if (props.diskUsage) {
    rows.push({
      id: '__disk-usage',
      label: props.diskUsage.label,
      value: props.diskUsage.value
    })
  }
  return rows
})

const lineageRows = computed<FactRow[]>(() => {
  return allFields.value.filter((field) => matchLabel(field, ['lineage'])).map(toRow)
})

const runningDetailRows = computed<FactRow[]>(() => {
  const id = props.installation?.id
  if (!id || !sessionStore.isRunning(id)) return []
  return allFields.value.filter((field) => matchLabel(field, ['active-port'])).map(toRow)
})

const groups = computed<FactGroup[]>(() => {
  const out: FactGroup[] = []
  const details = installDetailRows.value
  if (details.length > 0) {
    out.push({
      id: 'install-details',
      title: t('statusFactPanel.installDetails'),
      rows: details
    })
  }
  const running = runningDetailRows.value
  if (running.length > 0) {
    out.push({
      id: 'running-details',
      title: t('statusFactPanel.runningDetails'),
      rows: running
    })
  }
  const isLocalInstall = props.installation?.sourceCategory === 'local'
  const location = locationRows.value
  if (isLocalInstall && location.length > 0) {
    out.push({
      id: 'location-storage',
      title: t('statusFactPanel.locationStorage'),
      rows: location
    })
  }
  const lineage = lineageRows.value
  if (lineage.length > 0) {
    out.push({
      id: 'lineage',
      title: t('statusFactPanel.lineage'),
      rows: lineage
    })
  }
  return out
})
</script>

<template>
  <div class="status-fact-panel flex max-w-[720px] flex-col gap-3">
    <header v-if="installation" class="status-fact-hero mb-1 flex flex-col gap-1.5">
      <div class="status-fact-hero-title-row flex flex-wrap items-center gap-2">
        <span
          class="status-fact-hero-name-wrap group/name -ml-1.5 inline-flex max-w-full items-center gap-1.5"
        >
          <span
            v-if="nameEditable"
            id="status-fact-hero-name"
            ref="nameEl"
            class="status-fact-hero-name peer/name cursor-text hover:bg-[var(--brand-surface-bg-hover)] focus-visible:bg-[var(--brand-surface-bg-hover)] focus-visible:shadow-[0_0_0_2px_var(--focus-ring,var(--neutral-50))] min-w-0 truncate rounded-md px-1.5 py-0.5 text-[16px] leading-6 font-semibold text-text outline-none transition-[background-color] duration-[120ms] ease-[ease]"
            role="textbox"
            :aria-label="t('statusFactPanel.editName')"
            contenteditable="plaintext-only"
            spellcheck="false"
            @blur="handleNameBlur"
            @keydown.enter.prevent="($event.target as HTMLElement).blur()"
            @keydown.esc.prevent="handleNameEscape"
            @keydown.ctrl.a.prevent="handleNameSelectAll"
            @keydown.meta.a.prevent="handleNameSelectAll"
            @paste="handleNamePaste"
          />
          <span
            v-else
            class="status-fact-hero-name min-w-0 truncate rounded-md px-1.5 py-0.5 text-[16px] leading-6 font-semibold text-text outline-none transition-[background-color] duration-[120ms] ease-[ease] status-fact-hero-name-static cursor-default"
            >{{ installation.name }}</span
          >
          <Button
            v-if="nameEditable"
            variant="textonly"
            size="unset"
            type="button"
            class="status-fact-hero-edit-btn static inline-flex w-0 shrink-0 items-center justify-center -ml-1.5 overflow-hidden rounded-md border-none bg-transparent p-0 appearance-auto transition-[width,margin-left] duration-[120ms] ease-[ease] hover:bg-transparent focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--focus-ring,var(--neutral-50))] focus-visible:outline-offset-1 focus-visible:ring-0 group-hover/name:w-[17px] group-hover/name:ml-0 peer-focus-visible/name:w-[17px] peer-focus-visible/name:ml-0 focus-visible:w-[17px] focus-visible:ml-0 [&>svg]:opacity-0 group-hover/name:[&>svg]:opacity-60 peer-focus-visible/name:[&>svg]:opacity-60 focus-visible:[&>svg]:opacity-60"
            :aria-label="t('statusFactPanel.editName')"
            aria-controls="status-fact-hero-name"
            @click="focusName"
          >
            <Pencil
              :size="13"
              class="status-fact-hero-edit-hint shrink-0 text-text-muted transition-opacity duration-[120ms] ease-[ease] select-none"
              aria-hidden="true"
            />
          </Button>
        </span>
        <span
          v-if="installation.sourceLabel"
          class="status-fact-hero-badge shrink-0 rounded-[999px] bg-[color-mix(in_srgb,var(--text)_8%,transparent)] px-2 py-0.5 text-[11px] leading-4 font-medium text-text-muted"
        >
          {{ installation.sourceLabel }}
        </span>
      </div>
    </header>

    <section
      v-for="group in groups"
      :key="group.id"
      class="status-fact-group flex flex-col rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-[var(--brand-surface-bg)] px-[18px] pt-1.5 pb-2"
    >
      <h3
        class="status-fact-group-title mt-2 mb-1 text-[11px] font-semibold tracking-[0.04em] text-text-muted uppercase opacity-70"
      >
        {{ group.title }}
      </h3>
      <dl class="status-fact-list m-0 flex flex-col">
        <div
          v-for="row in group.rows"
          :key="row.id"
          class="status-fact-row grid min-h-9 grid-cols-[160px_minmax(0,1fr)] items-center gap-4 border-t border-solid border-border-hover py-2 first:border-t-0"
        >
          <dt class="m-0 text-[12px] leading-4 text-text-muted">{{ row.label }}</dt>
          <dd
            v-if="isUrlRow(row)"
            class="m-0 flex min-w-0 items-center justify-start gap-1.5 text-left text-[13px] leading-[19px] text-neutral-100 status-fact-url-dd flex-wrap gap-y-1"
          >
            <span class="status-fact-url-edit inline-flex min-w-0 max-w-full items-center gap-1.5">
              <span
                ref="urlEl"
                class="status-fact-value min-w-0 truncate status-fact-url-editable -ml-1.5 cursor-text rounded-md px-1.5 py-0.5 text-left outline-none transition-[background-color] duration-[120ms] ease-[ease] hover:bg-[var(--brand-surface-bg-hover)] focus-visible:bg-[var(--brand-surface-bg-hover)] focus-visible:shadow-[0_0_0_2px_var(--focus-ring,var(--neutral-50))] focus-visible:overflow-visible focus-visible:text-clip"
                role="textbox"
                :aria-label="t('statusFactPanel.editUrl')"
                contenteditable="plaintext-only"
                spellcheck="false"
                :title="row.value"
                @blur="handleUrlBlur"
                @keydown.enter.prevent="($event.target as HTMLElement).blur()"
                @keydown.esc.prevent="handleUrlEscape"
              />
              <Button
                variant="textonly"
                size="unset"
                type="button"
                class="status-fact-url-edit-btn static inline-flex size-[22px] shrink-0 items-center justify-center rounded-md border-none bg-transparent p-0 text-text-muted opacity-60 appearance-auto transition-[opacity,background-color,color] duration-[120ms] ease-[ease] hover:bg-[var(--brand-surface-bg-hover)] hover:text-text hover:opacity-100 focus-visible:bg-[var(--brand-surface-bg-hover)] focus-visible:text-text focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-0"
                :aria-label="t('statusFactPanel.editUrl')"
                :title="t('statusFactPanel.editUrl')"
                @click="focusUrlField"
              >
                <Pencil :size="12" aria-hidden="true" />
              </Button>
            </span>
            <span
              v-if="showUrlRestart"
              class="status-fact-restart-tag flex-none rounded-[9999px] border border-solid border-[color-mix(in_srgb,var(--warning)_36%,transparent)] bg-[color-mix(in_srgb,var(--warning)_14%,transparent)] px-1.5 py-px text-[10px] leading-[14px] font-medium tracking-[0.02em] whitespace-nowrap text-[var(--warning)] uppercase"
              role="status"
            >
              {{ t('statusFactPanel.restartToApply') }}
            </span>
          </dd>
          <dd
            v-else
            class="m-0 flex min-w-0 items-center justify-start gap-1.5 text-left text-[13px] leading-[19px] text-neutral-100"
          >
            <Button
              v-if="row.openable"
              variant="textonly"
              size="unset"
              type="button"
              class="status-fact-value min-w-0 truncate status-fact-value-open static inline-block rounded-lg border-none bg-transparent p-0 [font:inherit] text-inherit appearance-auto hover:bg-transparent hover:text-[var(--action)] hover:underline focus-visible:text-[var(--action)] focus-visible:underline focus-visible:outline-none focus-visible:ring-0"
              :class="{ 'is-truncate-start [direction:rtl] text-left': row.truncate === 'start' }"
              :title="t('models.openDir')"
              @click="openPath(row.value)"
            >
              <bdi v-if="row.truncate === 'start'" dir="ltr">{{ row.value }}</bdi>
              <template v-else>{{ row.value }}</template>
            </Button>
            <span
              v-else
              class="status-fact-value min-w-0 truncate"
              :class="{ 'is-truncate-start [direction:rtl] text-left': row.truncate === 'start' }"
              :title="row.value"
            >
              <bdi v-if="row.truncate === 'start'" dir="ltr">{{ row.value }}</bdi>
              <template v-else>{{ row.value }}</template>
            </span>
            <BaseCopyButton v-if="row.copyable" :value="row.value" />
          </dd>
        </div>
      </dl>
    </section>
  </div>
</template>
