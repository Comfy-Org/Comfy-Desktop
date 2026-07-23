<script setup lang="ts">
/**
 * One distribution, rendered as a chooser tile — a sibling of
 * `views/chooser/ChooserInstallTile.vue`: same box, same classes, same type
 * scale, same top-right kebab. Activating it is the same gesture as launching
 * an existing install.
 *
 * NAME is the headline; the single meta line beneath it carries the one fact
 * that matters for this card's state — the labelled versions ("v0.28.0 ·
 * Dist v12.0") when installable, or the state itself ("No build yet",
 * "OS incompatible", …). The top-right corner belongs to the kebab alone:
 * state never renders as a pill. Blocked tiles keep their full explanation
 * on `title` and are never hidden — these are ordinary pipeline facts, not
 * threats.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDownToLine, MoreVertical, Package } from 'lucide-vue-next'
import TruncatedText from '../../components/TruncatedText.vue'
import type { Distribution, DistributionState } from '../../devplatform/types'

const props = defineProps<{
  distribution: Distribution
}>()

const emit = defineEmits<{
  /** The user activated the tile — the host starts the install flow. */
  select: []
  /** The kebab was clicked — the host opens the distribution menu. */
  'open-kebab-menu': [event: MouseEvent]
}>()

const { t } = useI18n()

/** The three states that cannot be installed. Shown with a reason, never hidden. */
const BLOCKED_STATES: readonly DistributionState[] = [
  'no-build',
  'platform-mismatch',
  'needs-desktop-update',
]

/** i18n suffix per blocked state — keys both the short meta label (`states.*`)
 *  and the fallback long reason (`blockedReason.*`). */
const BLOCKED_STATE_KEY: Record<string, string> = {
  'no-build': 'noBuild',
  'platform-mismatch': 'platformMismatch',
  'needs-desktop-update': 'needsDesktopUpdate',
}

const isBlocked = computed(() => BLOCKED_STATES.includes(props.distribution.state))

/** The two labelled versions: ComfyUI's leads faint, the distribution's
 *  release follows emphasised — the shared faint-then-bright meta pattern,
 *  so the numbers can't be conflated. */
const comfyVersionLabel = computed(() => {
  const version = props.distribution.comfyuiVersion
  return version ? t('devPlatform.distribution.comfyVersion', { version }) : ''
})

const distVersionLabel = computed(() => {
  const version = props.distribution.version
  return version ? t('devPlatform.distribution.distVersion', { version }) : ''
})

const factsLine = computed(() =>
  [comfyVersionLabel.value, distVersionLabel.value].filter(Boolean).join(' · ')
)

/** A state that replaces the facts on the meta line. Update-available keeps
 *  the facts — its state renders as the Update pill. */
const stateLabel = computed(() => {
  const state = props.distribution.state
  if (isBlocked.value) {
    const suffix = BLOCKED_STATE_KEY[state] ?? 'noBuild'
    return t(`devPlatform.distribution.states.${suffix}`)
  }
  if (state === 'installed') return t('devPlatform.distribution.states.installed')
  return ''
})

/** The blue action pill, pinned right of the facts: Update on
 *  update-available, Install on installable — identical styling; the whole
 *  card is the click target that performs it. Empty = no pill. */
const actionPillLabel = computed(() => {
  const state = props.distribution.state
  if (state === 'update-available') return t('chooser.updatePill')
  if (state === 'installable') return t('devPlatform.distribution.menuInstall')
  return ''
})

/** Full-contrast explanation, carried on `title` so it eats no tile space. */
const blockedReason = computed(() => {
  if (!isBlocked.value) return ''
  const suffix =
    props.distribution.blockedReason ?? BLOCKED_STATE_KEY[props.distribution.state] ?? 'noBuild'
  return t(`devPlatform.distribution.blockedReason.${suffix}`, {
    version: props.distribution.minDesktopVersion ?? '',
  })
})

function onActivate(): void {
  if (isBlocked.value) return
  emit('select')
}
</script>

<template>
  <div
    class="chooser-tile chooser-tile--install dist-tile dist-tile--chooser"
    :class="{ 'dist-tile--blocked': isBlocked }"
    role="button"
    tabindex="0"
    :aria-disabled="isBlocked ? true : undefined"
    :title="blockedReason || undefined"
    :data-testid="`chooser-dist-tile-${distribution.id}`"
    @click="onActivate"
    @keydown.enter.prevent="onActivate"
    @keydown.space.prevent="onActivate"
  >
    <!-- "Packaged environment" glyph — the one icon every distribution wears. -->
    <span class="chooser-tile-icon" aria-hidden="true">
      <Package :size="32" />
    </span>

    <!-- Top-right is the kebab's alone — state lives on the meta line. -->
    <div class="chooser-tile-actions">
      <button
        type="button"
        class="chooser-tile-kebab"
        :title="t('chooser.moreActions')"
        :aria-label="t('chooser.moreActions')"
        :data-testid="`chooser-dist-kebab-${distribution.id}`"
        @click.stop="emit('open-kebab-menu', $event)"
        @contextmenu.stop="emit('open-kebab-menu', $event)"
        @keydown.enter.stop
        @keydown.space.stop
      >
        <MoreVertical :size="16" />
      </button>
    </div>

    <div class="chooser-tile-body">
      <TruncatedText class="chooser-tile-name" :text="distribution.name" />
      <div v-if="stateLabel || factsLine || actionPillLabel" class="chooser-tile-footer">
        <TruncatedText v-if="stateLabel" class="chooser-tile-meta-line" :text="stateLabel" />
        <TruncatedText v-else-if="factsLine" class="chooser-tile-meta-line" :text="factsLine">
          <span v-if="comfyVersionLabel" class="chooser-tile-meta-source">{{
            comfyVersionLabel
          }}</span>
          <span v-if="comfyVersionLabel && distVersionLabel" class="chooser-tile-meta-sep">·</span>
          <span v-if="distVersionLabel" class="chooser-tile-meta-version">{{
            distVersionLabel
          }}</span>
        </TruncatedText>
        <!-- Mirrors the install tile's update pill: facts left, pill pinned
             right. The whole card is the click target that performs it. -->
        <span
          v-if="actionPillLabel"
          class="chooser-tile-pill chooser-tile-pill-update chooser-tile-pill-action"
        >
          <ArrowDownToLine :size="11" aria-hidden="true" />
          {{ actionPillLabel }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import '../chooser/chooser-tiles.css';
@import './devplatform-tiles.css';
</style>
