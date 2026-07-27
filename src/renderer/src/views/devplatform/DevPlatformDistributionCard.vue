<script setup lang="ts">
/**
 * One distribution, rendered as a chooser tile: a sibling of
 * `views/chooser/ChooserInstallTile.vue` — same box, same classes, same type
 * scale, same top-right kebab. Activating it is the same gesture as launching
 * an existing install.
 *
 * NAME is the headline. The footer row follows the grammar the install tiles
 * use: LEFT is the ComfyUI version this distribution bundles and the fact that
 * you don't have it, RIGHT is the blue pill for the one thing you can do.
 *
 * A card is only ever an INSTALLABLE distribution not yet on this machine.
 * Installed ones de-duplicate into install tiles, and ones this machine can't
 * install are filtered out upstream (`ChooserView.chooserDistributions`) —
 * so there is no blocked treatment here to reason about.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDownToLine, MoreVertical, Package } from 'lucide-vue-next'
import TruncatedText from '../../components/TruncatedText.vue'
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

/** The facts line: the ComfyUI version this distribution bundles, then the fact
 *  that you don't have it yet. Once installed the tile shows the distribution's
 *  own release in this slot instead. */
const comfyVersionLabel = computed(() => props.distribution.comfyuiVersion ?? '')

const factsLine = computed(() =>
  [comfyVersionLabel.value, t('devPlatform.distribution.notInstalled')]
    .filter(Boolean)
    .join(' · ')
)

/** The blue pill: Install and Update are the same gesture — activate the card
 *  — so they wear the same pill. */
const actionPill = computed(() =>
  props.distribution.state === 'update-available'
    ? t('devPlatform.distribution.states.updateAvailable')
    : t('devPlatform.distribution.menuInstall')
)
</script>

<template>
  <div
    class="chooser-tile chooser-tile--install dist-tile dist-tile--chooser dist-tile--available"
    role="button"
    tabindex="0"
    :data-testid="`chooser-dist-tile-${distribution.id}`"
    @click="emit('select')"
    @keydown.enter.prevent="emit('select')"
    @keydown.space.prevent="emit('select')"
    @contextmenu.prevent="emit('open-kebab-menu', $event)"
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

    <!-- Two lines: name, then facts left / action right. -->
    <div class="chooser-tile-body">
      <TruncatedText class="chooser-tile-name" :text="distribution.name" />
      <div class="chooser-tile-footer">
        <TruncatedText v-if="factsLine" class="chooser-tile-meta-line" :text="factsLine">
          <span v-if="comfyVersionLabel" class="chooser-tile-meta-source">{{
            comfyVersionLabel
          }}</span>
          <span v-if="comfyVersionLabel" class="chooser-tile-meta-sep">·</span>
          <span class="chooser-tile-meta-version">{{
            t('devPlatform.distribution.notInstalled')
          }}</span>
        </TruncatedText>
        <span class="chooser-tile-pill chooser-tile-pill-update chooser-tile-pill-action">
          <ArrowDownToLine :size="11" aria-hidden="true" />
          {{ actionPill }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import '../chooser/chooser-tiles.css';
@import './devplatform-tiles.css';
</style>
