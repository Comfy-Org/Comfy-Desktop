<script setup lang="ts">
/**
 * One distribution, rendered as a chooser tile: a sibling of
 * `views/chooser/ChooserInstallTile.vue`: same box, same classes, same type
 * scale. Activating it is the same gesture as launching an existing install.
 *
 * NAME is the headline; version + size drop into the single meta row. Blocked
 * states (no-build / platform-mismatch / needs-desktop-update) are shown with
 * a short reason tag: full reason on `title`: and never hidden. No security
 * chrome: these are ordinary pipeline facts, not threats.
 *
 * The footer answers the installation tile's recency question honestly: a
 * distribution that isn't installed says "Not installed yet"; an installed one
 * carries the build's "updated" stamp.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertCircle, ArrowDownToLine, MoreVertical, Package } from 'lucide-vue-next'
import TruncatedText from '../../components/TruncatedText.vue'
import { formatBytesCoarse } from '../../lib/formatting'
import { formatRelativeFromMs } from '../../lib/datetime'
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

/** Present on this machine already: the two post-install states. */
const isInstalledLocally = computed(
  () => props.distribution.state === 'installed' || props.distribution.state === 'update-available'
)

const showAvailablePill = computed(() => props.distribution.state === 'installable')

const blockedLabel = computed(() => {
  if (!isBlocked.value) return ''
  const suffix = BLOCKED_STATE_KEY[props.distribution.state] ?? 'noBuild'
  return t(`devPlatform.distribution.states.${suffix}`)
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

const sizeLabel = computed(() =>
  props.distribution.sizeBytes ? formatBytesCoarse(props.distribution.sizeBytes) : ''
)

/** Dot-separated facts row: version · size. Both optional. */
const metaLine = computed(() =>
  [props.distribution.version, sizeLabel.value].filter(Boolean).join(' · ')
)

const updatedLabel = computed(() => {
  const iso = props.distribution.finishedAt
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  const rel = formatRelativeFromMs(ms, t)
  return rel ? `${t('devPlatform.distribution.updatedLabel')} ${rel}` : ''
})

const footerLabel = computed(() => {
  if (!isInstalledLocally.value) return t('devPlatform.distribution.installTileMeta')
  return updatedLabel.value
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
    :data-testid="`chooser-dist-tile-${distribution.id}`"
    @click="onActivate"
    @keydown.enter.prevent="onActivate"
    @keydown.space.prevent="onActivate"
  >
    <!-- "Packaged environment" glyph: the one icon every distribution wears. -->
    <span class="chooser-tile-icon" aria-hidden="true">
      <Package :size="22" />
    </span>

    <div class="chooser-tile-actions">
      <span
        v-if="isBlocked"
        class="chooser-tile-danger-tag dist-tile-tag--blocked"
        :title="blockedReason"
      >
        <AlertCircle :size="12" aria-hidden="true" />
        {{ blockedLabel }}
      </span>
      <!-- Update-available: the only state asking the user to act. -->
      <span
        v-else-if="distribution.state === 'update-available'"
        class="chooser-tile-pill dist-tile-pill--update"
      >
        <ArrowDownToLine :size="11" aria-hidden="true" />
        {{ t('devPlatform.distribution.states.updateAvailable') }}
      </span>
      <span
        v-else-if="distribution.state === 'installed'"
        class="chooser-tile-pill dist-tile-pill--installed"
      >
        {{ t('devPlatform.distribution.states.installed') }}
      </span>
      <!-- Says this tile is something you can ADD, which is what distinguishes
           it from the installation tiles beside it. -->
      <span v-else-if="showAvailablePill" class="chooser-tile-pill dist-tile-pill--available">
        {{ t('devPlatform.distribution.availablePill') }}
      </span>

      <!-- Same corner affordance as an install tile. Always present, blocked
           or not: a card whose kebab comes and goes reads as broken, and the
           menu still has something honest to say while blocked. -->
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

    <div class="chooser-tile-body">
      <TruncatedText class="chooser-tile-name" :text="distribution.name" />
      <TruncatedText v-if="metaLine" class="chooser-tile-meta-line" :text="metaLine">
        <span v-if="distribution.version" class="chooser-tile-meta-version">
          {{ distribution.version }}
        </span>
        <span v-if="distribution.version && sizeLabel" class="chooser-tile-meta-sep">·</span>
        <span v-if="sizeLabel" class="chooser-tile-meta-source">{{ sizeLabel }}</span>
      </TruncatedText>
      <div class="chooser-tile-footer">
        <span v-if="footerLabel" class="chooser-tile-recency">
          <span class="chooser-tile-recency-text">{{ footerLabel }}</span>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import '../chooser/chooser-tiles.css';
@import './devplatform-tiles.css';
</style>
