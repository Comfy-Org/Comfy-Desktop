<script setup lang="ts">
/**
 * One distribution as a chooser tile — a sibling of `ChooserInstallTile.vue`,
 * sharing its box, classes and footer grammar: facts on the left, ONE status
 * slot on the right (an action pill or a blocked tag, never both).
 *
 * Blocked states recede but are never hidden, keeping the full reason on
 * `title`.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDownToLine, MoreVertical, Package } from 'lucide-vue-next'
import TruncatedText from '../../components/TruncatedText.vue'
import { BLOCKED_STATE_KEY, isBlockedDistribution } from '../../devplatform/distributionState'
import type { Distribution } from '../../devplatform/types'

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

const isBlocked = computed(() => isBlockedDistribution(props.distribution))

/** A card is only ever an UNinstalled distribution — once installed it
 *  de-duplicates into an install tile, which fills this slot differently. */
const comfyVersionLabel = computed(() => props.distribution.comfyuiVersion ?? '')

const factsLine = computed(() =>
  [comfyVersionLabel.value, t('devPlatform.distribution.notInstalled')].filter(Boolean).join(' · ')
)

/** The catalog card represents an uninstalled distribution. Updates are
 *  actions on the existing installation tile instead. */
const actionPill = computed(() => {
  if (props.distribution.state === 'installable') return t('devPlatform.distribution.menuInstall')
  return ''
})

/** Build targets as product names. Proper nouns, so not translated. */
const OS_LABELS: Record<string, string> = {
  windows: 'Windows',
  mac: 'macOS',
  linux: 'Linux'
}

/** Why the tile is blocked. A platform mismatch names the machines the build IS
 *  for ("Linux") rather than the one it isn't, falling back to the generic
 *  label when the targets aren't known. */
const stateTag = computed(() => {
  if (!isBlocked.value) return ''
  const targets = props.distribution.targetOs
  if (props.distribution.state === 'platform-mismatch' && targets?.length) {
    return targets.map((os) => OS_LABELS[os] ?? os).join(' · ')
  }
  const suffix = BLOCKED_STATE_KEY[props.distribution.state] ?? 'noBuild'
  return t(`devPlatform.distribution.states.${suffix}`)
})

/** The long explanation, on `title` so it eats no tile space. */
const blockedReason = computed(() => {
  if (!isBlocked.value) return ''
  const suffix = props.distribution.blockedReason ?? 'buildFailed'
  return t(`devPlatform.distribution.blockedReason.${suffix}`)
})

function onActivate(): void {
  if (props.distribution.state !== 'installable') return
  emit('select')
}
</script>

<template>
  <!-- A blocked tile is not activatable, so it is a plain group rather than a
       disabled button: a disabled button role would also announce the nested
       (still active) kebab as disabled. -->
  <div
    class="chooser-tile chooser-tile--install dist-tile dist-tile--chooser"
    :class="{ 'dist-tile--blocked': isBlocked, 'dist-tile--available': !isBlocked }"
    :role="isBlocked ? undefined : 'button'"
    :tabindex="isBlocked ? undefined : 0"
    :title="blockedReason || undefined"
    :data-testid="`chooser-dist-tile-${distribution.id}`"
    @click="onActivate"
    @keydown.enter.prevent="onActivate"
    @keydown.space.prevent="onActivate"
    @contextmenu.prevent="emit('open-kebab-menu', $event)"
  >
    <!-- The one glyph every distribution wears, installed or not. -->
    <span class="chooser-tile-icon" aria-hidden="true">
      <Package :size="22" />
    </span>

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
          <span v-if="comfyVersionLabel" class="chooser-tile-meta-source">{{
            comfyVersionLabel
          }}</span>
          <span v-if="comfyVersionLabel" class="chooser-tile-meta-sep">·</span>
          <span class="chooser-tile-meta-version">{{
            t('devPlatform.distribution.notInstalled')
          }}</span>
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
