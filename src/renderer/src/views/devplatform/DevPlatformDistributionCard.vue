<script setup lang="ts">
/**
 * One distribution, rendered as a chooser tile: a sibling of
 * `views/chooser/ChooserInstallTile.vue` — same box, same classes, same type
 * scale, same top-right kebab. Activating it is the same gesture as launching
 * an existing install.
 *
 * NAME is the headline. The footer row follows the grammar the install tiles
 * use: LEFT is identity facts (labelled version · size), RIGHT is one
 * status/action slot — a pill for what you can do (Install / Update), or a
 * quiet tag for what simply is (Installed, or why it's blocked). Never both,
 * and state never replaces the facts.
 *
 * The version is labelled ("Dist v2") because these cards share a grid with
 * install tiles, whose version IS the ComfyUI version. A bare "2" beside a
 * "0.3.20" invites misreading.
 *
 * Blocked states (no-build / platform-mismatch / needs-desktop-update) recede
 * but are never hidden, and keep their full reason on the tile's `title`. No
 * security chrome: these are ordinary pipeline facts, not threats.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDownToLine, MoreVertical, Package } from 'lucide-vue-next'
import TruncatedText from '../../components/TruncatedText.vue'
import { formatBytesCoarse } from '../../lib/formatting'
import type { Distribution, DistributionState } from '../../devplatform/types'

const props = defineProps<{
  distribution: Distribution
}>()

const emit = defineEmits<{
  /** The user activated the tile: the host starts the install flow. */
  select: []
  /** Kebab pressed: the host opens the distribution menu at this anchor. */
  'open-kebab-menu': [event: MouseEvent]
}>()

const { t } = useI18n()

/** The three states that cannot be installed. Shown with a reason, never hidden. */
const BLOCKED_STATES: readonly DistributionState[] = [
  'no-build',
  'platform-mismatch',
  'needs-desktop-update',
]

/** i18n suffix per blocked state: keys both the short tag label (`states.*`)
 *  and the fallback long reason (`blockedReason.*`). */
const BLOCKED_STATE_KEY: Record<string, string> = {
  'no-build': 'noBuild',
  'platform-mismatch': 'platformMismatch',
  'needs-desktop-update': 'needsDesktopUpdate',
}

const isBlocked = computed(() => BLOCKED_STATES.includes(props.distribution.state))

const sizeLabel = computed(() =>
  props.distribution.sizeBytes ? formatBytesCoarse(props.distribution.sizeBytes) : ''
)

/** Labelled so it can't be read as a ComfyUI version (see file header). */
const versionLabel = computed(() =>
  props.distribution.version
    ? t('devPlatform.distribution.distVersion', { version: props.distribution.version })
    : ''
)

/** Dot-separated identity facts: version · size. Both optional. */
const factsLine = computed(() => [versionLabel.value, sizeLabel.value].filter(Boolean).join(' · '))

/** Right slot, part one: the blue pill for an action the card performs.
 *  Install and Update are the same gesture — activate the card — so they
 *  wear the same pill. Empty when there's nothing to do. */
const actionPill = computed(() => {
  if (props.distribution.state === 'update-available')
    return t('devPlatform.distribution.states.updateAvailable')
  if (props.distribution.state === 'installable')
    return t('devPlatform.distribution.menuInstall')
  return ''
})

/** Right slot, part two: a quiet tag for a fact the user can't act on —
 *  why it's blocked, or that it's already installed. Only consulted when
 *  `actionPill` is empty; the two never render together. */
const stateTag = computed(() => {
  if (isBlocked.value) {
    const suffix = BLOCKED_STATE_KEY[props.distribution.state] ?? 'noBuild'
    return t(`devPlatform.distribution.states.${suffix}`)
  }
  if (props.distribution.state === 'installed')
    return t('devPlatform.distribution.states.installed')
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
    <!-- "Packaged environment" glyph: the one icon every distribution wears. -->
    <span class="chooser-tile-icon" aria-hidden="true">
      <Package :size="22" />
    </span>

    <!-- The corner is the kebab's alone; state lives on the footer row. -->
    <div class="chooser-tile-actions">
      <button
        type="button"
        class="chooser-tile-kebab"
        :title="t('chooser.moreActions')"
        :aria-label="t('chooser.moreActions')"
        :data-testid="`chooser-dist-tile-kebab-${distribution.id}`"
        @click.stop="emit('open-kebab-menu', $event)"
        @contextmenu.stop.prevent="emit('open-kebab-menu', $event)"
        @keydown.enter.stop
        @keydown.space.stop
      >
        <MoreVertical :size="16" />
      </button>
    </div>

    <!-- Two lines: name, then facts left / one status slot right. -->
    <div class="chooser-tile-body">
      <TruncatedText class="chooser-tile-name" :text="distribution.name" />
      <div v-if="factsLine || actionPill || stateTag" class="chooser-tile-footer">
        <TruncatedText v-if="factsLine" class="chooser-tile-meta-line" :text="factsLine">
          <span v-if="versionLabel" class="chooser-tile-meta-version">{{ versionLabel }}</span>
          <span v-if="versionLabel && sizeLabel" class="chooser-tile-meta-sep">·</span>
          <span v-if="sizeLabel" class="chooser-tile-meta-source">{{ sizeLabel }}</span>
        </TruncatedText>
        <span
          v-if="actionPill"
          class="chooser-tile-pill chooser-tile-pill-update chooser-tile-pill-action"
        >
          <ArrowDownToLine :size="11" aria-hidden="true" />
          {{ actionPill }}
        </span>
        <span
          v-else-if="stateTag"
          class="chooser-tile-pill chooser-tile-pill-action dist-tile-state-tag"
        >
          {{ stateTag }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import '../chooser/chooser-tiles.css';
@import './devplatform-tiles.css';
</style>
